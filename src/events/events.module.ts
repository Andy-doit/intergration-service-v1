import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { VendureModule } from '../vendure/vendure.module';
import { ODOO_EVENT_QUEUE } from './events.constants';
import { EventsController } from './events.controller';
import { EventsProcessor } from './events.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: ODOO_EVENT_QUEUE,
    }),
    BullBoardModule.forFeature({
      name: ODOO_EVENT_QUEUE,
      adapter: BullMQAdapter,
    }),
    // Import OrdersModule để EventsProcessor có OrdersService
    OrdersModule,
    VendureModule,
  ],
  controllers: [EventsController],
  providers: [EventsProcessor],
})
export class EventsModule {}
