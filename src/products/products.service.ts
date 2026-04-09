import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RedisService } from '../redis/redis.service';
import { SyncStockDto } from './dto/sync-stock.dto';
import { Inventory, InventoryChangeType } from './entities/inventory.entity';
import { Product } from './entities/product.entity';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,

    private readonly redisService: RedisService,
    private readonly httpService: HttpService, // Để dùng cho Fallback S1
  ) {}

  /**
   * Sync stock từ Odoo:
   *  1. Upsert Product catalog trong PostgreSQL.
   *  2. Ghi số lượng tuyệt đối vào Redis (stock:qty + stock:ts).
   *  3. Append Inventory audit log.
   */
  async syncStock(dto: SyncStockDto): Promise<Product> {
    // ── 1. Chuẩn bị dữ liệu Product (Upsert) ─────────────────────────────────
    let product = await this.productRepo.findOne({
      where: { id: dto.product_id },
    });

    if (!product) {
      // Nếu là lần đầu sync, bắt buộc phải có đủ sku và name
      if (!dto.sku || !dto.name) {
        throw new Error(
          `Sản phẩm chưa tồn tại trong hệ thống. Cần cung cấp đầy đủ 'sku' và 'name' ở lần đồng bộ đầu tiên (product_id: ${dto.product_id}).`,
        );
      }
      product = this.productRepo.create({
        id: dto.product_id,
        sku: dto.sku,
        name: dto.name,
        category: dto.category ?? null,
        price: dto.price ?? 0,
        unit: dto.unit ?? 'cái',
        is_active: true,
      });
    } else {
      // Nếu đã tồn tại, chắp vá những trường thông tin Odoo gửi sang
      if (dto.sku) product.sku = dto.sku;
      if (dto.name) product.name = dto.name;
      if (dto.category) product.category = dto.category;
      if (dto.price !== undefined) product.price = dto.price;
      if (dto.unit) product.unit = dto.unit;
    }

    product.last_synced_at = new Date();
    await this.productRepo.save(product);

    // ── 2. Xử lý tồn kho (chỉ khi có biến qty_on_hand) ────────────────────────
    if (dto.qty_on_hand !== undefined && dto.qty_on_hand !== null) {
      const previousQty = await this.redisService.getStockQty(dto.product_id);
      await this.redisService.setStockQty(dto.product_id, dto.qty_on_hand);

      this.logger.log(
        `[StockSync] product=${dto.product_id} | prev=${previousQty ?? 'N/A'} → now=${dto.qty_on_hand}`,
      );

      // Append Inventory audit log
      const delta =
        previousQty !== null ? dto.qty_on_hand - previousQty : dto.qty_on_hand;

      await this.inventoryRepo.save(
        this.inventoryRepo.create({
          product_id: dto.product_id,
          product,
          change_type: InventoryChangeType.SYNC,
          delta,
          qty_after: dto.qty_on_hand,
          note: `Synced from Odoo at ${new Date().toISOString()}`,
        }),
      );
    }

    return product;
  }

  /** Lấy thông tin product + qty hiện tại trong Redis. S1 FALLBACK được áp dụng ở đây */
  async getProductWithStock(
    productId: string,
  ): Promise<{ product: Product; qty: number | null }> {
    const product = await this.productRepo.findOneOrFail({
      where: { id: productId },
    });
    let qty = await this.redisService.getStockQty(productId);

    // [Fallback S1] - Redis hết hạn TTL (Null) -> Bốc từ Odoo
    if (qty === null) {
      this.logger.warn(`⚠️ Cache bốc hơi (TTL Expired), bắt đầu Fallback đọc từ Odoo (S1) cho ${productId}`);
      try {
        const odooUrl = process.env.ODOO_BASE_URL || 'http://localhost';
        // API giả lập vì chưa có Endpoint thật - Thường Odoo sẽ có API GET tồn kho theo ID
        const response = await firstValueFrom(
          this.httpService.get(`${odooUrl}/api/stock/${productId}?token=${process.env.ODOO_WEBHOOK_SECRET}`)
        );
        
        // Trích tồn kho từ phản hồi của Odoo
        qty = response.data?.qty_on_hand ?? 0;
        
        // Lưu ngược lại xuống Redis với TTL 60s
        await this.redisService.setStockQty(productId, qty as number);
        this.logger.log(`✅ Fallback thành công. Đã phục hồi tồn kho ${qty} vào Cache 60s.`);
      } catch(err: any) {
        this.logger.error(`❌ Lỗi Fallback: Không thể đọc API tồn kho Odoo cho mã ${productId}`, err.stack);
        qty = 0; // Backup fail-safe
      }
    }

    return { product, qty };
  }

  /** Lịch sử thay đổi kho của một sản phẩm */
  async getInventoryLog(productId: string): Promise<Inventory[]> {
    return this.inventoryRepo.find({
      where: { product_id: productId },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  /** Ghi log RESERVE vào audit trail (gọi từ OrdersService) */
  async logReserve(
    productId: string,
    qty: number,
    orderId: string,
    qtyAfter: number,
  ): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) return;

    await this.inventoryRepo.save(
      this.inventoryRepo.create({
        product_id: productId,
        product,
        change_type: InventoryChangeType.RESERVE,
        delta: -qty,
        qty_after: qtyAfter,
        order_id: orderId,
        note: `Soft-reserve for order ${orderId}`,
      }),
    );
  }

  /** Ghi log RELEASE vào audit trail (gọi từ compensation) */
  async logRelease(
    productId: string,
    qty: number,
    orderId: string,
    qtyAfter: number,
  ): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) return;

    await this.inventoryRepo.save(
      this.inventoryRepo.create({
        product_id: productId,
        product,
        change_type: InventoryChangeType.RELEASE,
        delta: qty,
        qty_after: qtyAfter,
        order_id: orderId,
        note: `Released reserve for order ${orderId} (compensation)`,
      }),
    );
  }
}
