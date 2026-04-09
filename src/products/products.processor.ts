import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProductsService } from './products.service';
import { SyncStockDto } from './dto/sync-stock.dto';
import { PRODUCT_SYNC_QUEUE } from './products.constants';

@Processor(PRODUCT_SYNC_QUEUE)
export class ProductsProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductsProcessor.name);

  constructor(private readonly productsService: ProductsService) {
    super();
  }

  async process(job: Job<SyncStockDto>): Promise<void> {
    const displayId = job.data.product_id || job.data.id;
    const displaySku = job.data.sku || job.data.default_code || 'N/A';
    
    this.logger.log(`[Worker] Bắt đầu xử lý đồng bộ (ID: ${displayId} | SKU: ${displaySku})`);
    
    try {
      // 1. Lưu DB nội bộ Gateway và cập nhật Redis (Chuẩn S1)
      const product = await this.productsService.syncStock(job.data);
      this.logger.log(`[Worker] Đồng bộ hoàn thành mã: ${product.sku}`);
    } catch (error) {
      const displayId = job.data.product_id || job.data.id || 'N/A';
      const displaySku = job.data.sku || job.data.default_code || 'N/A';
      this.logger.error(`[Worker] Lỗi đồng bộ (ID: ${displayId} | SKU: ${displaySku})`, (error as Error).stack);
      throw error; // Throw lại để BullMQ auto retry
    }
  }
}
