import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService, ODOO_CREATE_PICKING_QUEUE } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    BullModule.registerQueue({
      name: ODOO_CREATE_PICKING_QUEUE,
    }),
    BullBoardModule.forFeature({
      name: ODOO_CREATE_PICKING_QUEUE,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
