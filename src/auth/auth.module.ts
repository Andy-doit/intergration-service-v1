import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { VendureModule } from '../vendure/vendure.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Product]),
    VendureModule,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
