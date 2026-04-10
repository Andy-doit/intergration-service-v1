import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProductsService } from './products.service';
import { SyncStockDto } from './dto/sync-stock.dto';
import { PRODUCT_SYNC_QUEUE } from './products.constants';
import { VendureAdminService } from '../vendure/vendure-admin.service';

@Processor(PRODUCT_SYNC_QUEUE)
export class ProductsProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductsProcessor.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly vendureAdminService: VendureAdminService,
  ) {
    super();
  }

  async process(job: Job<SyncStockDto>): Promise<void> {
    const data = job.data;
    const displayId = data.product_id || data.id;
    const displaySku = data.sku || data.default_code || 'N/A';

    this.logger.log(
      `[Worker] Bắt đầu xử lý đồng bộ (ID: ${displayId} | SKU: ${displaySku})`,
    );

    try {
      // 1. Lưu DB nội bộ Gateway và cập nhật Redis (Chuẩn S1)
      const product = await this.productsService.syncStock(data);
      this.logger.log(`[Worker] Đã lưu local cho mã: ${product.sku}`);

      // 2. Đẩy sang Vendure (Chuẩn S1-V)
      // Map data từ Odoo DTO sang Vendure Upsert format
      const sku = data.sku || data.default_code;
      const name = data.name || data.display_name;
      const price = data.price !== undefined ? data.price : data.list_price;
      const qty =
        data.qty_on_hand !== undefined ? data.qty_on_hand : data.qty_available;

      if (sku && name) {
        await this.vendureAdminService.upsertAdminProduct({
          sku,
          name,
          price: Number(price || 0),
          qty: qty !== undefined ? Number(qty) : undefined,
          unit: data.unit,
        });
      } else {
        this.logger.warn(
          `⚠️ Bỏ qua đẩy Vendure do thiếu SKU hoặc Name (ID: ${displayId})`,
        );
      }
    } catch (error) {
      const displayId = job.data.product_id || job.data.id || 'N/A';
      const displaySku = job.data.sku || job.data.default_code || 'N/A';
      this.logger.error(
        `[Worker] Lỗi đồng bộ (ID: ${displayId} | SKU: ${displaySku})`,
        (error as Error).stack,
      );
      throw error; // Throw lại để BullMQ auto retry
    }
  }
}
