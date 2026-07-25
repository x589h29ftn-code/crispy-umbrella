-- Werkpakket 4: transactionele mail met terugkoppeling. Bij SMTP weet je alleen
-- dat de mail is aangeboden, niet of hij is afgeleverd, gebounced of in spam belandde.

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "mailMessageId" TEXT,
ADD COLUMN     "mailStatus" "MailStatus",
ADD COLUMN     "mailStatusAt" TIMESTAMP(3),
ADD COLUMN     "mailBounceType" TEXT,
ADD COLUMN     "mailBounceReason" TEXT,
ADD COLUMN     "mailOpenedAt" TIMESTAMP(3),
ADD COLUMN     "mailResendCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Recipient_mailMessageId_idx" ON "Recipient"("mailMessageId");

-- CreateTable
CREATE TABLE "MailEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "messageId" TEXT,
    "recipientId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: uniek, zodat dezelfde gebeurtenis niet twee keer wordt verwerkt.
CREATE UNIQUE INDEX "MailEvent_providerEventId_key" ON "MailEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "MailEvent_messageId_idx" ON "MailEvent"("messageId");

-- CreateIndex
CREATE INDEX "MailEvent_recipientId_idx" ON "MailEvent"("recipientId");
