import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SyncStockDto } from './dto/sync-stock.dto';
import { ProductsService } from './products.service';
import { PRODUCT_SYNC_QUEUE } from './products.constants';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    @InjectQueue(PRODUCT_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  /**
   * POST /products/sync
   * Nhận stock sync từ Odoo (S1).
   * Upsert catalog + ghi Redis + ghi audit log.
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncStock(@Body() body: SyncStockDto | SyncStockDto[]) {
    const dataArray = Array.isArray(body) ? body : [body];

    for (const dto of dataArray) {
      await this.syncQueue.add('sync_job', dto, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });
    }

    return {
      message: `Đã nhận yêu cầu đồng bộ cho ${dataArray.length} sản phẩm`,
      status: 'queued',
    };
  }

  /**
   * GET /products/:productId/stock
   * Trả về thông tin product + qty hiện tại trong Redis.
   */
  @Get(':productId/stock')
  async getStockInfo(@Param('productId') productId: string) {
    return this.productsService.getProductWithStock(productId);
  }

  /**
   * GET /products/:productId/inventory-log
   * Lịch sử thay đổi kho (100 bản ghi gần nhất).
   */
  @Get(':productId/inventory-log')
  async getInventoryLog(@Param('productId') productId: string) {
    return this.productsService.getInventoryLog(productId);
  }
}
