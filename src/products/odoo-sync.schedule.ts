import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class OdooSyncSchedule {
  private readonly logger = new Logger(OdooSyncSchedule.name);

  constructor(
    @InjectQueue('odoo-vendure-sync')
    private readonly syncQueue: Queue,
  ) {}

  /**
   * Tự động quét Master Data định kỳ (S2)
   * Ở Gateway Hub: Quét để cập nhật kho và giá địa phương.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron() {
    this.logger.log('⏰ [Cron] Bắt đầu kích hoạt đồng bộ Master Data tự động...');
    await this.syncQueue.add('sync-catalog', { ts: Date.now() });
  }

  /**
   * Kích hoạt thủ công từ Dashboard
   */
  async triggerManualSync() {
    this.logger.log('⚡ [Manual] Kích hoạt đồng bộ Master Data từ Dashboard...');
    await this.syncQueue.add('manual-sync', { ts: Date.now() });
  }
}
