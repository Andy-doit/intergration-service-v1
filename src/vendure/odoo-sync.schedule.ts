import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ODOO_VENDURE_SYNC_QUEUE } from './vendure.constants';

@Injectable()
export class OdooSyncSchedule {
  private readonly logger = new Logger(OdooSyncSchedule.name);

  constructor(
    @InjectQueue(ODOO_VENDURE_SYNC_QUEUE)
    private readonly syncQueue: Queue,
  ) {}

  /**
   * Chạy hàng ngày vào lúc 03:00 sáng
   */
  @Cron('0 3 * * *')
  async handleDailyMasterDataSync() {
    this.logger.log('⏰ Bắt đầu tiến trình đồng bộ tự động S2 lúc 03:00 AM...');
    await this.triggerSync();
  }

  /**
   * Gọi thông qua API bằng tay / thủ công
   */
  async triggerManualSync() {
    this.logger.log('👉 Trigger bằng tay tiến trình đồng bộ S2...');
    await this.triggerSync();
  }

  private async triggerSync() {
    // Đẩy một Job vào rổ để Worker lo
    await this.syncQueue.add(
      'sync_all_master_data',
      { timestamp: new Date().toISOString() },
      {
        attempts: 3, // Retry 3 lần
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );
    this.logger.log(`✅ Đã đẩy lệnh đồng bộ S2 vào BullMQ.`);
  }
}
