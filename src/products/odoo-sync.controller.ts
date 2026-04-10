import { Controller, Post, HttpCode } from '@nestjs/common';
import { OdooSyncSchedule } from './odoo-sync.schedule';

@Controller('admin/hub')
export class OdooSyncController {
  constructor(private readonly odooSyncSchedule: OdooSyncSchedule) {}

  /**
   * Endpoint kích hoạt đồng bộ Master Data từ Odoo về Hub
   */
  @Post('manual-sync-master')
  @HttpCode(202)
  async manualSyncMaster() {
    await this.odooSyncSchedule.triggerManualSync();
    return {
      message:
        '🚀 Đã đẩy lệnh đồng bộ danh mục từ Odoo về Gateway Hub. Vui lòng kiểm tra Dashboard Hub.',
    };
  }
}
