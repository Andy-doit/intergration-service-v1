import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });

    this.client.on('connect', () =>
      this.logger.log('Redis connected successfully'),
    );
    this.client.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  // ─── Expose raw client (for BullMQ shared connection) ───────────────────────
  getClient(): Redis {
    return this.client;
  }

  // ─── S1: Stock Read/Write ────────────────────────────────────────────────────

  /**
   * Cập nhật số lượng tồn kho cố định của sản phẩm với TTL = 60s
   */
  async setStockQty(productId: string, qty: number): Promise<void> {
    const key = `stock:qty:${productId}`;
    const tsKey = `stock:ts:${productId}`;
    const now = Date.now().toString();

    const multi = this.client.multi();
    // Gán biến tồn kho tự động chết sau 60 giây (theo chuẩn S1)
    multi.set(key, qty.toString(), 'EX', 60);
    multi.set(tsKey, now, 'EX', 60);
    await multi.exec();
  }

  /**
   * Đọc số lượng tồn kho hiện tại.
   * Trả về null nếu chưa có dữ liệu.
   */
  async getStockQty(productId: string): Promise<number | null> {
    const val = await this.client.get(`stock:qty:${productId}`);
    return val !== null ? parseInt(val, 10) : null;
  }

  /**
   * Đọc timestamp lần cập nhật kho cuối cùng.
   */
  async getStockTimestamp(productId: string): Promise<number | null> {
    const val = await this.client.get(`stock:ts:${productId}`);
    return val !== null ? parseInt(val, 10) : null;
  }

  // ─── Soft-Reserve ────────────────────────────────────────────────────────────

  /**
   * Trừ kho mềm (Soft-Reserve) khi đặt hàng.
   * Dùng DECRBY để giảm stock:qty:{product_id}.
   * Lưu tracking key: reserve:{product_id}:{order_draft_id} = qty
   *
   * @returns số lượng kho còn lại sau khi trừ. Nếu < 0 => thiếu hàng.
   */
  async softReserve(
    productId: string,
    orderDraftId: string,
    qty: number,
  ): Promise<number> {
    const stockKey = `stock:qty:${productId}`;
    const reserveKey = `reserve:${productId}:${orderDraftId}`;

    const pipeline = this.client.pipeline();
    pipeline.decrby(stockKey, qty);
    // Lưu tracking để có thể release sau này
    pipeline.set(reserveKey, qty);
    const results = await pipeline.exec();

    // results[0][1] là giá trị sau DECRBY
    const remaining = results?.[0]?.[1] as number;
    this.logger.log(
      `Soft-reserve: product=${productId}, order=${orderDraftId}, qty=${qty}, remaining=${remaining}`,
    );
    return remaining;
  }

  /**
   * Giải phóng kho (Release) khi Odoo reject đơn.
   * Dùng INCRBY để hoàn lại stock:qty:{product_id}.
   * Xóa tracking key: reserve:{product_id}:{order_draft_id}.
   */
  async releaseReserve(
    productId: string,
    orderDraftId: string,
  ): Promise<void> {
    const reserveKey = `reserve:${productId}:${orderDraftId}`;
    const stockKey = `stock:qty:${productId}`;

    // Lấy qty đã reserve
    const reservedQtyStr = await this.client.get(reserveKey);
    if (!reservedQtyStr) {
      this.logger.warn(
        `No reserve found for product=${productId}, order=${orderDraftId}`,
      );
      return;
    }

    const reservedQty = parseInt(reservedQtyStr, 10);
    const pipeline = this.client.pipeline();
    pipeline.incrby(stockKey, reservedQty);
    pipeline.del(reserveKey);
    await pipeline.exec();

    this.logger.log(
      `Released reserve: product=${productId}, order=${orderDraftId}, qty=${reservedQty}`,
    );
  }

  /**
   * Giải phóng kho cho nhiều sản phẩm cùng lúc (dùng trong Compensation).
   */
  async releaseReserveMany(
    items: Array<{ productId: string; qty?: number }>,
    orderDraftId: string,
  ): Promise<void> {
    for (const item of items) {
      await this.releaseReserve(item.productId, orderDraftId);
    }
  }

  /**
   * Xóa tracking key sau khi đã release (hoặc khi compensation hoàn tất).
   */
  async deleteReserveTracking(
    productId: string,
    orderDraftId: string,
  ): Promise<void> {
    const reserveKey = `reserve:${productId}:${orderDraftId}`;
    await this.client.del(reserveKey);
  }

  // ─── Idempotency ─────────────────────────────────────────────────────────────

  /**
   * Kiểm tra và đặt idempotency key (SET NX EX 60).
   * Trả về true nếu key ĐÃ tồn tại (event đã xử lý rồi → bỏ qua).
   * Trả về false nếu key CHƯA tồn tại (event mới → tiến hành xử lý).
   */
  async checkIdempotency(key: string): Promise<boolean> {
    // SET key "1" EX 60 NX  (ioredis v5: EX must come before NX)
    const result = await this.client.set(key, '1', 'EX', 60, 'NX');
    // result === null nghĩa là key đã tồn tại → đã xử lý rồi
    const alreadyProcessed = result === null;
    if (alreadyProcessed) {
      this.logger.warn(`Idempotency hit: key="${key}" already processed`);
    }
    return alreadyProcessed;
  }
}
