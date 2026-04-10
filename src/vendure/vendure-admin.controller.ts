import { Controller, Post, HttpCode } from '@nestjs/common';
import { OdooSyncSchedule } from './odoo-sync.schedule';

@Controller('admin/vendure')
export class VendureAdminController {
  constructor(private readonly odooSyncSchedule: OdooSyncSchedule) {}

  @Post('manual-sync-master')
  @HttpCode(202)
  async manualSyncMaster() {
    await this.odooSyncSchedule.triggerManualSync();
    return {
      message:
        'Đã đẩy lệnh đồng bộ danh mục từ Odoo sang Vendure (S2) vào hàng đợi. Vui lòng kiểm tra Bull Board.',
    };
  }
}
