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
    this.logger.log(`[Worker] Khởi tạo đồng bộ mã: ${job.data.sku} (Product: ${job.data.product_id})`);
    
    try {
      // 1. Lưu DB nội bộ Gateway và cập nhật Redis (Chuẩn S1)
      const product = await this.productsService.syncStock(job.data);
      this.logger.log(`[Worker] Đồng bộ hoàn thành mã: ${product.sku}`);
    } catch (error) {
      this.logger.error(`[Worker] Lỗi đồng bộ mã ${job.data.sku}`, (error as Error).stack);
      throw error; // Throw lại để BullMQ auto retry
    }
  }
}
