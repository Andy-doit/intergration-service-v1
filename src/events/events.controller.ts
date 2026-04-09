import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { OdooWebhookDto } from './dto/odoo-webhook.dto';
import { ODOO_EVENT_QUEUE } from './events.constants';


@Controller('api/events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    @InjectQueue(ODOO_EVENT_QUEUE)
    private readonly eventQueue: Queue,

    private readonly redisService: RedisService,
  ) {}

  /**
   * POST /api/events/odoo
   * Ingress webhook nhận sự kiện từ Odoo.
   *
   * Luồng:
   *  1. Build idempotency key = "{order_id}:{event_type}:{timestamp}"
   *  2. Kiểm tra Redis SET NX EX 60 → nếu đã tồn tại → return 200 sớm.
   *  3. Đẩy event vào BullMQ queue `odoo.events` để worker xử lý.
   */
  @Post('odoo')
  @HttpCode(HttpStatus.OK)
  async receiveOdooEvent(@Body() dto: OdooWebhookDto): Promise<{ message: string }> {
    const idempotencyKey = `idempotent:${dto.order_id}:${dto.event_type}:${dto.timestamp}`;

    // ── Check idempotency ───────────────────────────────────────────────────
    const alreadyProcessed = await this.redisService.checkIdempotency(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.warn(
        `[Webhook] Duplicate event skipped: key=${idempotencyKey}`,
      );
      return { message: 'Event already processed (idempotent)' };
    }

    // ── Đẩy vào queue để worker xử lý bất đồng bộ ─────────────────────────
    await this.eventQueue.add(dto.event_type, dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    });

    this.logger.log(
      `[Webhook] Event queued: type=${dto.event_type}, order_id=${dto.order_id}`,
    );

    return { message: 'Event accepted' };
  }
}
