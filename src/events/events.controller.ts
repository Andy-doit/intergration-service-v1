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
import { OdooRawWebhookDto } from './dto/odoo-raw-webhook.dto';
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
  async receiveOdooEvent(
    @Body() body: any,
  ): Promise<{ message: string }> {
    this.logger.debug(`[Webhook] RECIEVED FROM ODOO: ${JSON.stringify(body)}`);

    let dto: OdooWebhookDto;

    // ── Kiểm tra xem là Webhook thô hay Webhook chuẩn ───────────────────────
    if (body.origin && body.display_name) {
      // ĐÂY LÀ WEBHOOK THÔ (Send Webhook Notification)
      const raw = body as OdooRawWebhookDto;
      dto = {
        order_id: raw.origin || 'unknown', // Source Document
        event_type: 'odoo_raw_status', // Sẽ được Processor phân loại dựa trên state/display_name
        timestamp: Math.floor(Date.now() / 1000),
        odoo_picking_id: raw.display_name,
        payload: {
          state: raw.state,
          display_name: raw.display_name,
        },
      };
      this.logger.debug(`[Webhook] Received raw Odoo event for origin=${raw.origin}`);
    } else {
      // ĐÂY LÀ WEBHOOK CHUẨN (từ Python script cũ)
      dto = body as OdooWebhookDto;
    }

    if (!dto.order_id || dto.order_id === 'unknown') {
      this.logger.warn(`[Webhook] Missing order_id/origin. Body keys: ${Object.keys(body).join(', ')}`);
      // Vẫn return 200 để Odoo không report lỗi, nhưng log lại để debug
      return { message: 'Accepted but missing crucial data (origin)' };
    }

    const idempotencyKey = `idempotent:${dto.order_id}:${dto.event_type}:${dto.odoo_picking_id}:${dto.payload?.state || ''}`;

    // ── Check idempotency ───────────────────────────────────────────────────
    const alreadyProcessed =
      await this.redisService.checkIdempotency(idempotencyKey);
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
      `[Webhook] Event queued: type=${dto.event_type}, order_id=${dto.order_id}, picking=${dto.odoo_picking_id}`,
    );

    return { message: 'Event accepted' };
  }
}
