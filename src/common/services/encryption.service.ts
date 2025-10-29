import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');

    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Cannot initialize encryption service.',
      );
    }

    // Ensure key is exactly 32 bytes for AES-256
    this.key = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32), 'utf-8');

    this.logger.log('EncryptionService initialized successfully');
  }

  /**
   * Encrypt a string with AES-256-CBC
   * Format: salt:iv:encryptedData
   */
  encrypt(text: string): string {
    if (!text) {
      throw new Error('Cannot encrypt empty text');
    }

    // Generate random salt and IV for each encryption
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);

    // Derive key from password and salt using scrypt
    const derivedKey = crypto.scryptSync(this.key, salt, 32);

    // Create cipher
    const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv);

    // Encrypt
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return format: salt:iv:encrypted
    return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a string encrypted with this service
   * Expected format: salt:iv:encryptedData
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) {
      throw new Error('Cannot decrypt empty text');
    }

    try {
      // Parse the encrypted format
      const parts = encryptedText.split(':');

      if (parts.length !== 3) {
        // Handle old encryption format (for backwards compatibility)
        return this.decryptLegacy(encryptedText);
      }

      const [saltHex, ivHex, encrypted] = parts;

      const salt = Buffer.from(saltHex, 'hex');
      const iv = Buffer.from(ivHex, 'hex');

      // Derive key from password and salt
      const derivedKey = crypto.scryptSync(this.key, salt, 32);

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv);

      // Decrypt
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error('Failed to decrypt data. Encryption key may be incorrect.');
    }
  }

  /**
   * Decrypt old format (iv:encrypted) for backwards compatibility
   * This allows migration from old encryption method
   */
  private decryptLegacy(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts.shift() || '', 'hex');
      const encryptedData = parts.join(':');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);

      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt legacy format data');
    }
  }

  /**
   * Generate a secure random password/key
   */
  generateSecureKey(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash a password (for passwords that should not be decrypted)
   */
  hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Verify if the encryption service is properly configured
   */
  verifyConfiguration(): boolean {
    try {
      const testString = 'test-encryption-' + Date.now();
      const encrypted = this.encrypt(testString);
      const decrypted = this.decrypt(encrypted);

      return decrypted === testString;
    } catch (error) {
      this.logger.error('Encryption configuration verification failed:', error);
      return false;
    }
  }
}
