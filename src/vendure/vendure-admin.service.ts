import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface VendureGqlResponse<T> {
  data?: T;
  errors?: any[];
}

interface TransitionOrderResponse {
  transitionOrderToState: {
    __typename: string;
    id?: string;
    state?: string;
    errorCode?: string;
    message?: string;
  };
}

interface VariantResponse {
  productVariants: {
    items: Array<{
      id: string;
      price: number;
      stockLevel: number;
      product: { id: string };
    }>;
  };
}

interface ProductResponse {
  createProduct?: { id: string };
  updateProduct?: { id: string };
}

interface CreateVariantResponse {
  createProductVariants: Array<{ id: string }>;
}

interface StockResponse {
  productVariant?: {
    stockLevels: Array<{ stockOnHand: number }>;
  };
}

/**
 * Dịch vụ kết nối và điều khiển trực tiếp Vendure Admin API (GraphQL)
 */
@Injectable()
export class VendureAdminService implements OnModuleInit {
  private readonly logger = new Logger(VendureAdminService.name);
  private adminApiUrl: string;
  private authToken: string | null = null;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.adminApiUrl =
      this.configService.get<string>('VENDURE_API_URL') ||
      'http://localhost:3000/admin-api';
  }

  async onModuleInit() {
    // Để an toàn, chúng ta chưa cần login ngay lúc khởi động,
    // Hệ thống sẽ login Lazy (chỉ khi có yêu cầu đẩy data)
  }

  /**
   * Tự động đăng nhập vào Vendure và lấy Token
   */
  private async authenticate(): Promise<string> {
    if (this.authToken) return this.authToken;

    const username =
      this.configService.get<string>('VENDURE_ADMIN_USERNAME') || 'superadmin';
    const password =
      this.configService.get<string>('VENDURE_ADMIN_PASSWORD') || 'superadmin';

    this.logger.log(
      `🔄 Đang đăng nhập Bot vào Vendure Admin [User: ${username}]...`,
    );

    const loginMutation = `
      mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password) {
          ... on CurrentUser {
            id
            identifier
          }
          ... on InvalidCredentialsError {
            errorCode
            message
          }
        }
      }
    `;

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.adminApiUrl, {
          query: loginMutation,
          variables: { username, password },
        }),
      );

      const loginResult = response.data?.data?.login;

      if (loginResult?.__typename === 'CurrentUser') {
        // Vendure trả token vào Header 'vendure-auth-token' đối với 'bearer' method
        const token = response.headers['vendure-auth-token'];

        if (token) {
          this.authToken = token;
          this.logger.log(
            '✅ Đăng nhập Vendure Admin thành công (Nhận Token)!',
          );
          return token;
        } else {
          this.logger.warn(
            '⚠️ Đăng nhập thành công nhưng không thấy header "vendure-auth-token". Hãy kiểm tra lại "tokenMethod" trong cấu hình Vendure.',
          );
          // Dự phòng cho cookie (cần thư viện xử lý cookie nếu tokenMethod = 'cookie')
        }
      } else {
        this.logger.error(
          `❌ Đăng nhập thất bại: ${loginResult?.message || 'Lỗi không xác định'}`,
        );
      }
    } catch (err: any) {
      this.logger.error(`❌ Lỗi kết nối đến Vendure API: ${err.message}`);
    }

    throw new Error('Không thể xác thực với Vendure Admin.');
  }

  /**
   * Gọi một GraphQL Query/Mutation với Authentication
   */
  private async queryGraphQL<T = any>(query: string, variables: any = {}): Promise<T> {
    const token = await this.authenticate();

    try {
      const response = await firstValueFrom(
        this.httpService.post<VendureGqlResponse<T>>(
          this.adminApiUrl,
          { query, variables },
          {
            headers: {
              Authorization: `Bearer ${token}`, // Thường dùng cho custom
              'vendure-auth-token': token, // Chuẩn gốc của Vendure
            },
          },
        ),
      );

      if (response.data?.errors) {
        this.logger.error(
          '⚠️ GraphQL Error từ Vendure:',
          JSON.stringify(response.data.errors, null, 2),
        );
        throw new Error('Vendure GraphQL Reject Validation');
      }

      return response.data?.data as T;
    } catch (err: any) {
      if (err.response?.status === 401) {
        // Nếu Token hết hạn -> Xoá đi để gọi lại vào lần sau
        this.authToken = null;
        this.logger.warn('⚠️ Vendure Token hết hạn, đang thử đăng nhập lại...');
        return this.queryGraphQL<T>(query, variables);
      }
      throw err;
    }
  }

  /**
   * 🏗️ Tự động tạo hoặc Cập nhật Sản Phẩm (Product Master Data) sang Vendure
   */
  async upsertAdminProduct(productData: {
    sku: string;
    name: string;
    price: number;
    qty?: number;
    unit?: string;
  }) {
    this.logger.log(`⏳ Đang đồng bộ SKU: ${productData.sku} sang Vendure...`);

    try {
      // 1. Kiểm tra xem Variant với SKU này đã tồn tại chưa
      const existingVariant = await this.findProductVariantBySku(
        productData.sku,
      );

      if (existingVariant) {
        this.logger.log(
          `📝 SKU ${productData.sku} đã tồn tại (ID: ${existingVariant.id}). Đang cập nhật...`,
        );

        // Cập nhật Product Name (translations)
        await this.updateProductName(
          existingVariant.product.id,
          productData.name,
        );

        // Cập nhật Variant Price
        await this.updateVariantPrice(existingVariant.id, productData.price);

        // Cập nhật tồn kho nếu có
        if (productData.qty !== undefined) {
          await this.syncInventory(existingVariant.id, productData.qty);
        }

        this.logger.log(
          `✅ [Vendure] Đã cập nhật xong SKU: ${productData.sku}`,
        );
      } else {
        this.logger.log(`🆕 SKU ${productData.sku} chưa có. Đang tạo mới...`);

        // Tạo Product mới
        const productId = await this.createProduct(productData);
        if (productId) {
          // Tạo Variant mới
          const variantId = await this.createDefaultVariant(
            productId,
            productData,
          );

          // Cập nhật tồn kho ban đầu nếu có
          if (variantId && productData.qty !== undefined) {
            await this.syncInventory(variantId, productData.qty);
          }

          this.logger.log(
            `✅ [Vendure] Đã tạo mới thành công SKU: ${productData.sku}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.error(
        `❌ [Vendure] Lỗi Upsert Sản Phẩm (SKU: ${productData.sku}): ${e.message}`,
      );
      throw e;
    }
  }

  /**
   * Tìm Variant theo SKU
   */
  private async findProductVariantBySku(sku: string) {
    const query = `
      query GetVariantBySku($sku: String!) {
        productVariants(options: { filter: { sku: { eq: $sku } } }) {
          items {
            id
            price
            stockLevel
            product {
              id
            }
          }
        }
      }
    `;

    const result = await this.queryGraphQL(query, { sku });
    return result?.productVariants?.items?.[0] || null;
  }

  /**
   * Tạo Product vỏ
   */
  private async createProduct(productData: {
    name: string;
    sku: string;
    unit?: string;
  }) {
    const mutation = `
      mutation CreateProductFromOdoo($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
        }
      }
    `;

    const variables = {
      input: {
        translations: [
          {
            languageCode: 'en',
            name: productData.name,
            slug: productData.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: `<p>Được đồng bộ từ Odoo.</p><p>Đơn vị: ${productData.unit || 'cái'}</p>`,
          },
        ],
      },
    };

    const result = await this.queryGraphQL(mutation, variables);
    return result?.createProduct?.id;
  }

  /**
   * Cập nhật tên Product
   */
  private async updateProductName(productId: string, name: string) {
    const mutation = `
      mutation UpdateProductName($input: UpdateProductInput!) {
        updateProduct(input: $input) {
          id
        }
      }
    `;

    const variables = {
      input: {
        id: productId,
        translations: [
          {
            languageCode: 'en',
            name: name,
          },
        ],
      },
    };

    await this.queryGraphQL(mutation, variables);
  }

  /**
   * Tạo Mẫu (Variant) Mặc định
   */
  private async createDefaultVariant(
    productId: string,
    productData: { sku: string; price: number },
  ) {
    const mutation = `
      mutation CreateProductVariant($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
          ... on ProductVariant {
             id
          }
        }
      }
    `;

    const variables = {
      input: [
        {
          productId: productId,
          sku: productData.sku,
          price: productData.price,
          translations: [{ languageCode: 'en', name: 'Default' }],
        },
      ],
    };

    const result = await this.queryGraphQL(mutation, variables);
    return result?.createProductVariants?.[0]?.id;
  }

  /**
   * Cập nhật giá Variant
   */
  private async updateVariantPrice(variantId: string, price: number) {
    const mutation = `
      mutation UpdateVariantPrice($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
          ... on ProductVariant {
            id
          }
        }
      }
    `;

    const variables = {
      input: [{ id: variantId, price }],
    };

    await this.queryGraphQL(mutation, variables);
  }

  /**
   * Đồng bộ tồn kho (Set giá trị tuyệt đối)
   */
  private async syncInventory(variantId: string, qty: number) {
    const mutation = `
      mutation AdjustStock($input: [AdjustProductVariantInventoryInput!]!) {
        adjustProductVariantInventory(input: $input) {
          ... on ProductVariant {
            id
          }
        }
      }
    `;

    const query = `query { productVariant(id: "${variantId}") { stockLevels { stockOnHand } } }`;
    const res = await this.queryGraphQL(query);
    const currentStock =
      res?.productVariant?.stockLevels?.[0]?.stockOnHand || 0;
    const delta = qty - currentStock;

    if (delta !== 0) {
      await this.queryGraphQL(mutation, {
        input: [{ productVariantId: variantId, adjustment: delta }],
      });
    }
  }

  /**
   * Chuyển trạng thái đơn hàng trong Vendure
   */
  async transitionOrderToState(vendureOrderId: string, state: string) {
    this.logger.log(
      `⏳ Đang chuyển trạng thái đơn hàng ${vendureOrderId} sang "${state}" trong Vendure...`,
    );

    const mutation = `
      mutation TransitionOrder($id: ID!, $state: String!) {
        transitionOrderToState(id: $id, state: $state) {
          ... on Order {
            id
            state
          }
          ... on OrderStateTransitionError {
             errorCode
             message
             fromState
             toState
          }
        }
      }
    `;

    try {
      const result = await this.queryGraphQL<TransitionOrderResponse>(mutation, {
        id: vendureOrderId,
        state,
      });
      const transitionResult = result?.transitionOrderToState;

      if (transitionResult?.__typename === 'Order') {
        this.logger.log(
          `✅ [Vendure] Đã chuyển đơn hàng ${vendureOrderId} sang trạng thái: ${transitionResult.state ?? 'unknown'}`,
        );
        return transitionResult;
      } else {
        this.logger.error(
          `❌ [Vendure] Lỗi chuyển trạng thái đơn hàng ${vendureOrderId}: ${transitionResult?.message || 'Lỗi không xác định'}`,
        );
        return null;
      }
    } catch (e: any) {
      this.logger.error(
        `❌ [Vendure] Lỗi kết nối khi chuyển trạng thái đơn hàng: ${e.message as string}`,
      );
      throw e;
    }
  }
}
