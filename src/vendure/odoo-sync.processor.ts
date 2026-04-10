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

    const baseUrl = process.env.ODOO_BASE_URL || 'http://localhost:8069';
    const db = process.env.ODOO_DB || 'Ten_DB_Odoo';
    const username = process.env.ODOO_USERNAME || 'admin';
    const password = process.env.ODOO_PASSWORD || 'admin';

    try {
      // 1. Authenticate (JSON-RPC common.login)
      this.logger.log(`[Worker S2] Authenticating with Odoo DB: ${db}...`);
      const authPayload = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'common',
          method: 'login',
          args: [db, username, password],
        },
        id: Date.now(),
      };

      const authRes = await firstValueFrom(
        this.httpService.post(`${baseUrl}/jsonrpc`, authPayload),
      );
      const uid = authRes.data?.result;

      if (!uid) {
        throw new Error('Đăng nhập Odoo thất bại (Sai Database, User hoặc Pass)');
      }

      this.logger.log(`[Worker S2] Auth thành công. UID: ${uid}. Fetching Products...`);

      // 2. Search & Read Products (JSON-RPC object.execute_kw)
      const listPayload = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [
            db,
            uid,
            password,
            'product.product',
            'search_read',
            [[]], // Domain: Tất cả sản phẩm
            {
              fields: [
                'id',
                'name',
                'default_code',
                'list_price',
                'lst_price',
                'qty_available',
                'uom_id',
              ],
              limit: 500, // Để an toàn, lấy tối đa 500 bản ghi
            },
          ],
        },
        id: Date.now() + 1,
      };

      const dataRes = await firstValueFrom(
        this.httpService.post(`${baseUrl}/jsonrpc`, listPayload),
      );
      const products = dataRes.data?.result || [];

      if (products.length === 0) {
        this.logger.warn(`⚠️ Odoo trả về 0 sản phẩm. Kết thúc tiến trình S2.`);
        return;
      }

      this.logger.log(
        `✅ Tìm thấy ${products.length} sản phẩm. Đang cập nhật sang Vendure...`,
      );

      let successCount = 0;
      let failCount = 0;

      for (const prod of products) {
        try {
          // Odoo list_price/lst_price có thể là 0 hoặc false
          const finalPrice = prod.lst_price || prod.list_price || 0;
          
          await this.vendureAdminService.upsertAdminProduct({
            sku: prod.default_code || `odoo-${prod.id}`,
            name: prod.name,
            price: Number(finalPrice),
            qty: Number(prod.qty_available || 0),
            unit: Array.isArray(prod.uom_id) ? prod.uom_id[1] : 'cái',
          });
          successCount++;
        } catch (e: any) {
          this.logger.error(`❌ Lỗi đồng bộ SP [${prod.name}]: ${e.message}`);
          failCount++;
        }
      }

      this.logger.log(
        `[Worker S2] Hoàn tất. Thành công: ${successCount}, Thất bại: ${failCount}.`,
      );
    } catch (error: any) {
      this.logger.error(
        `[Worker S2] Lỗi hệ thống khi đồng bộ Odoo: ${error.message}`,
      );
      throw error; // Để BullMQ thực hiện Retry
    }
  }
}
