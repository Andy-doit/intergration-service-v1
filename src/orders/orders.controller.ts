import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /orders
   * Trigger: Khi có event `order.confirmed` từ Storefront.
   * - Thực hiện Soft-Reserve kho qua Redis.
   * - Lưu DB trạng thái CONFIRMED.
   * - Đẩy job vào BullMQ queue `odoo.create_picking`.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.createOrder(dto);
  }
}
