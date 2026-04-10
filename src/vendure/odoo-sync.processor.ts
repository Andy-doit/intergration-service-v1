import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ODOO_VENDURE_SYNC_QUEUE } from './vendure.constants';
import { VendureAdminService } from './vendure-admin.service';

@Processor(ODOO_VENDURE_SYNC_QUEUE)
export class OdooSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(OdooSyncProcessor.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly vendureAdminService: VendureAdminService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(
      `[Worker S2] Bắt đầu đồng bộ danh mục Odoo sang Vendure (Job ID: ${job.id})`,
    );

    const odooUrl = process.env.ODOO_BASE_URL || 'http://localhost';
    const odooToken = process.env.ODOO_WEBHOOK_SECRET || '';

    try {
      this.logger.log(`Fetching Master Data from Odoo API...`);
      // Giả lập API gọi Odoo lấy danh sách sản phẩm.
      // Odoo thực tế có thể trả JSON: [{ id, sku, name, list_price, uom_id }]
      const response = await firstValueFrom(
        this.httpService.get(`${odooUrl}/api/products?token=${odooToken}`),
      );

      const products = response.data?.products || [];
      if (products.length === 0) {
        this.logger.warn(`⚠️ Odoo trả về 0 sản phẩm. Kết thúc tiến trình S2.`);
        return;
      }

      this.logger.log(
        `✅ Tìm thấy ${products.length} sản phẩm. Tiến hành bắn sang Vendure...`,
      );

      let successCount = 0;
      let failCount = 0;

      for (const prod of products) {
        try {
          await this.vendureAdminService.upsertAdminProduct({
            sku: prod.sku,
            name: prod.name,
            price: Number(prod.price || 0),
            qty:
              prod.qty_available !== undefined
                ? Number(prod.qty_available)
                : prod.qty_on_hand !== undefined
                  ? Number(prod.qty_on_hand)
                  : undefined,
            unit: prod.unit || 'cái',
          });
          successCount++;
        } catch (e: any) {
          this.logger.error(`❌ Lỗi đồng bộ SP ${prod.sku}: ${e.message}`);
          failCount++;
        }
      }

      this.logger.log(
        `[Worker S2] Xong! Thành công: ${successCount}, Thất bại: ${failCount}.`,
      );

      // Nếu thất bại quá 2 lần liên tiếp (Theo chuẩn S2)... hiện tại logic fail 1 sp không throw lỗi tổng.
      // Nếu muốn throw để BullMQ retry lại cả mảng, ta quăng throw new Error().
    } catch (error: any) {
      this.logger.error(
        `[Worker S2] Lỗi MẠNG khi cào API Odoo: ${error.message}`,
      );
      throw error; // Quăng lỗi để BullMQ chạy Retry 3x
    }
  }
}
