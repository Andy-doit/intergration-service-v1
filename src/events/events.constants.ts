/**
 * Các hằng số dùng chung cho Events module.
 * Tách riêng để tránh circular import giữa controller và processor.
 */

/** Queue nhận event webhook từ Odoo (S5) */
export const ODOO_EVENT_QUEUE = '🔄 Trạng thái Đơn hàng (Order Webhooks)';
