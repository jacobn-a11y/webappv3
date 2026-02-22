-- Add notification type used by automation run alerts
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SYSTEM_ALERT';
