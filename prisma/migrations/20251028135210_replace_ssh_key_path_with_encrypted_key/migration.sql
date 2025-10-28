-- AlterTable
-- Add new sshKey column (encrypted key content stored in database)
ALTER TABLE "remote_instances" ADD COLUMN "sshKey" TEXT;

-- Drop old sshKeyPath column (file path storage)
ALTER TABLE "remote_instances" DROP COLUMN "sshKeyPath";
