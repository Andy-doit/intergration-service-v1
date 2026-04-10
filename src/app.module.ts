import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './redis/redis.module';
import { OrdersModule } from './orders/orders.module';
import { EventsModule } from './events/events.module';
import { ProductsModule } from './products/products.module';
import { Order } from './orders/entities/order.entity';
import { OrderLog } from './orders/entities/order-log.entity';
import { Product } from './products/entities/product.entity';
import { Inventory } from './products/entities/inventory.entity';
import { AuthModule } from './auth/auth.module';
import { AuthMiddleware } from './auth/auth.middleware';

@Module({
  imports: [
    // ── Config (Global) ──────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── TypeORM (PostgreSQL) ─────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'integration_service'),
        entities: [Order, OrderLog, Product, Inventory],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
    }),

    // ── BullMQ (Global connection dùng Redis) ────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      }),
    }),

    // ── Bull Board (Queue monitoring UI) ────────────────────────────────────
    BullBoardModule.forRoot({
      route: '/admin/_internal_queues_monitor_',
      adapter: ExpressAdapter,
      boardOptions: {
        uiConfig: {
          boardTitle: 'G8HOMEMARKET ORDER GATEWAY',
          boardLogo: {
            path: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png', // Temporary generic gateway logo
            width: 30,
            height: 30,
          },
        },
      },
    }),

    ScheduleModule.forRoot(),

    // ── Feature Modules ──────────────────────────────────────────────────────
    RedisModule,
    AuthModule,
    ProductsModule, // Phải trước OrdersModule vì Orders dùng ProductsService
    OrdersModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes('admin/dashboard', 'admin/_internal_queues_monitor_');
  }
}
