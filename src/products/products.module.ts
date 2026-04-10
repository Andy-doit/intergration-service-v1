import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { VendureModule } from '../vendure/vendure.module';
import { HttpModule } from '@nestjs/axios';

import { Inventory } from './entities/inventory.entity';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsProcessor } from './products.processor';
import { PRODUCT_SYNC_QUEUE } from './products.constants';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { OdooSyncSchedule } from './odoo-sync.schedule';
import { OdooSyncController } from './odoo-sync.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Inventory]),
    BullModule.registerQueue({
      name: PRODUCT_SYNC_QUEUE,
    }, {
      name: 'odoo-vendure-sync', // Sử dụng string để tránh circular dependency từ constants
    }),
    BullBoardModule.forFeature({
      name: PRODUCT_SYNC_QUEUE,
      adapter: BullMQAdapter,
    }, {
      name: 'odoo-vendure-sync',
      adapter: BullMQAdapter,
    }),
    VendureModule,
    HttpModule,
  ],
  controllers: [ProductsController, OdooSyncController],
  providers: [
    ProductsService, 
    ProductsProcessor,
    OdooSyncProcessor,
    OdooSyncSchedule,
  ],
  exports: [ProductsService, OdooSyncSchedule], // Export để OrdersService, EventsProcessor và AuthController sử dụng
})
export class ProductsModule {}
