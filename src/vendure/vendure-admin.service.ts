import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

    const username = this.configService.get<string>('VENDURE_ADMIN_USERNAME') || 'superadmin';
    const password = this.configService.get<string>('VENDURE_ADMIN_PASSWORD') || 'superadmin';

    this.logger.log(`🔄 Đang đăng nhập Bot vào Vendure Admin [User: ${username}]...`);

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
          this.logger.log('✅ Đăng nhập Vendure Admin thành công (Nhận Token)!');
          return token;
        } else {
          this.logger.warn('⚠️ Đăng nhập thành công nhưng không thấy header "vendure-auth-token". Hãy kiểm tra lại "tokenMethod" trong cấu hình Vendure.');
          // Dự phòng cho cookie (cần thư viện xử lý cookie nếu tokenMethod = 'cookie')
        }
      } else {
         this.logger.error(`❌ Đăng nhập thất bại: ${loginResult?.message || 'Lỗi không xác định'}`);
      }
    } catch (err: any) {
      this.logger.error(`❌ Lỗi kết nối đến Vendure API: ${err.message}`);
    }

    throw new Error('Không thể xác thực với Vendure Admin.');
  }

  /**
   * Gọi một GraphQL Query/Mutation với Authentication
   */
  private async queryGraphQL(query: string, variables: any = {}) {
    const token = await this.authenticate();

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.adminApiUrl,
          { query, variables },
          {
            headers: {
              Authorization: `Bearer ${token}`, // Thường dùng cho custom
              'vendure-auth-token': token,      // Chuẩn gốc của Vendure
            },
          },
        ),
      );

      if (response.data?.errors) {
        this.logger.error('⚠️ GraphQL Error từ Vendure:', JSON.stringify(response.data.errors, null, 2));
        throw new Error('Vendure GraphQL Reject Validation');
      }

      return response.data?.data;
    } catch (err: any) {
      if (err.response?.status === 401) {
        // Nếu Token hết hạn -> Xoá đi để gọi lại vào lần sau
        this.authToken = null;
        this.logger.warn('⚠️ Vendure Token hết hạn, đang thử đăng nhập lại...');
        return this.queryGraphQL(query, variables); 
      }
      throw err;
    }
  }

  /**
   * 🏗️ Tự động tạo hoặc Bổ trợ Khung Sản Phẩm (Product Master Data) sang Vendure
   */
  async upsertAdminProduct(productData: {
    sku: string;
    name: string;
    price: number;
    unit?: string;
  }) {
    this.logger.log(`⏳ Đang móc API sang Vendure để tạo sản phẩm SKU: ${productData.sku}...`);

    // Gói tin chuẩn theo Format GraphQL của `createProduct` trong Vendure (Basic)
    const createProductMutation = `
      mutation CreateProductFromOdoo($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
          createdAt
        }
      }
    `;

    // Một sản phẩm trong Vendure bắt buộc phải có ít nhất 1 ngôn ngữ (translations)
    const variables = {
      input: {
        translations: [
          {
            languageCode: "en",
            name: productData.name,
            slug: productData.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: `<p>Sản phẩm đồng bộ tự động từ hệ thống Odoo Gateway.</p><p>Đơn vị tính gốc: <b>${productData.unit || 'cái'}</b></p>`
          }
        ]
      }
    };

    try {
      const result = await this.queryGraphQL(createProductMutation, variables);
      const productId = result?.createProduct?.id;

      if (productId) {
        this.logger.log(`✅ [Vendure] Đã tạo thành công Product (ID: ${productId}).`);
        
        // *Chú ý:* Ở Vendure, khung Product chỉ là cái vỏ. Giá trị, SKU và Giá bán nằm ở "Product Variant".
        // Để một sản phẩm có thể bán được, ta phải bắn tiếp API `createProductVariants`.
        await this.createDefaultVariant(productId, productData);
      }
    } catch (e: any) {
      this.logger.error(`❌ [Vendure] Lỗi Tạo Sản Phẩm (SKU: ${productData.sku}): ${e.message}`);
    }
  }

  /**
   * 🏗️ Tạo Mẫu (Variant) Mặc định cho sản phẩm
   */
  private async createDefaultVariant(productId: string, productData: { sku: string, price: number }) {
     const createVariantMutation = `
      mutation CreateProductVariant($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
          ... on ProductVariant {
             id
             sku
             price
          }
        }
      }
    `;

    const variables = {
      input: [
         {
           productId: productId,
           sku: productData.sku,
           price: productData.price, // Giá truyền sang thường là Int (VND)
           translations: [
             {
               languageCode: "en",
               name: "Mặc định (Default Variant)"
             }
           ]
         }
      ]
    };

    await this.queryGraphQL(createVariantMutation, variables);
    this.logger.log(`✅ [Vendure] Đã gắn mã SKU ${productData.sku} và Giá bán ${productData.price}đ.`);
  }
}
