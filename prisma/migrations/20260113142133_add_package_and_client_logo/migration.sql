-- DropForeignKey
ALTER TABLE `account` DROP FOREIGN KEY `Account_userId_fkey`;

-- DropForeignKey
ALTER TABLE `emailcontact` DROP FOREIGN KEY `EmailContact_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `emailmessage` DROP FOREIGN KEY `EmailMessage_campaignId_fkey`;

-- DropForeignKey
ALTER TABLE `emailverification` DROP FOREIGN KEY `EmailVerification_userId_fkey`;

-- DropForeignKey
ALTER TABLE `tokenblacklist` DROP FOREIGN KEY `TokenBlacklist_userId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsappcontact` DROP FOREIGN KEY `WhatsAppContact_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsappmessage` DROP FOREIGN KEY `WhatsAppMessage_campaignId_fkey`;

-- CreateTable
CREATE TABLE `clientlogo` (
    `id` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `package` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price` INTEGER NOT NULL,
    `duration` INTEGER NOT NULL DEFAULT 30,
    `maxContacts` INTEGER NOT NULL DEFAULT 100,
    `maxWaBroadcast` INTEGER NOT NULL DEFAULT 500,
    `maxEmailBroadcast` INTEGER NOT NULL DEFAULT 1000,
    `maxWaSessions` INTEGER NOT NULL DEFAULT 1,
    `maxGmailAccounts` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `package_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `emailverification` ADD CONSTRAINT `emailverification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account` ADD CONSTRAINT `account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokenblacklist` ADD CONSTRAINT `tokenblacklist_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcontact` ADD CONSTRAINT `whatsappcontact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappmessage` ADD CONSTRAINT `whatsappmessage_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `wacampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emailcontact` ADD CONSTRAINT `emailcontact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emailmessage` ADD CONSTRAINT `emailmessage_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `emailcampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `account` RENAME INDEX `Account_provider_providerAccountId_key` TO `account_provider_providerAccountId_key`;

-- RenameIndex
ALTER TABLE `emailcontact` RENAME INDEX `EmailContact_ownerId_email_key` TO `emailcontact_ownerId_email_key`;

-- RenameIndex
ALTER TABLE `emailverification` RENAME INDEX `EmailVerification_userId_tokenHash_idx` TO `emailverification_userId_tokenHash_idx`;

-- RenameIndex
ALTER TABLE `gmailaccount` RENAME INDEX `GmailAccount_email_key` TO `gmailaccount_email_key`;

-- RenameIndex
ALTER TABLE `tokenblacklist` RENAME INDEX `TokenBlacklist_token_key` TO `tokenblacklist_token_key`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_email_key` TO `user_email_key`;

-- RenameIndex
ALTER TABLE `whatsappcontact` RENAME INDEX `WhatsAppContact_ownerId_phone_key` TO `whatsappcontact_ownerId_phone_key`;
