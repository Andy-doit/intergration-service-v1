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

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Inventory]),
    BullModule.registerQueue({
      name: PRODUCT_SYNC_QUEUE,
    }),
    BullBoardModule.forFeature({
      name: PRODUCT_SYNC_QUEUE,
      adapter: BullMQAdapter,
    }),
    VendureModule,
    HttpModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsProcessor],
  exports: [ProductsService], // Export để OrdersService và EventsProcessor có thể gọi logReserve/logRelease
})
export class ProductsModule {}
