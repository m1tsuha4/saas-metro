/*
  Warnings:

  - A unique constraint covering the columns `[ownerId,phone]` on the table `WhatsAppContact` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ownerId` to the `WhatsAppContact` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `WhatsAppContact_phone_key` ON `whatsappcontact`;

-- AlterTable
ALTER TABLE `whatsappcontact` ADD COLUMN `ownerId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `WhatsAppContact_ownerId_phone_key` ON `WhatsAppContact`(`ownerId`, `phone`);

-- AddForeignKey
ALTER TABLE `WhatsAppContact` ADD CONSTRAINT `WhatsAppContact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailContact` ADD CONSTRAINT `EmailContact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
