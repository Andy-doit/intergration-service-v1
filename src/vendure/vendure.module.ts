import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { VendureAdminService } from './vendure-admin.service';
import { VendureAdminController } from './vendure-admin.controller';
import { ODOO_VENDURE_SYNC_QUEUE } from './vendure.constants';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 2,
    }),
    BullModule.registerQueue({
      name: ODOO_VENDURE_SYNC_QUEUE,
    }),
  ],
  controllers: [],
  providers: [VendureAdminService],
  exports: [VendureAdminService],
})
export class VendureModule {}
