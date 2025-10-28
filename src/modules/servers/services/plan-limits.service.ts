import {
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlanType, ServerStatus } from '@prisma/client';

/**
 * Plan configuration defining limits per plan type
 */
interface PlanLimits {
  maxServers: number;           // Maximum servers user can create
  maxRunningServers: number;    // Maximum servers that can run simultaneously
  displayName: string;          // Plan display name
}

/**
 * User's current usage and limits
 */
interface UserLimits {
  planType: PlanType;
  displayName: string;
  maxServers: number;
  maxRunningServers: number;
  currentServers: number;
  currentRunningServers: number;
  canCreateMore: boolean;
  canStartMore: boolean;
}

@Injectable()
export class PlanLimitsService {
  private readonly logger = new Logger(PlanLimitsService.name);

  /**
   * Plan configurations
   * These define the limits for each plan tier
   */
  private readonly PLAN_CONFIGS: Record<PlanType, PlanLimits> = {
    [PlanType.FREE]: {
      maxServers: 3,
      maxRunningServers: 1,
      displayName: 'Free',
    },
    [PlanType.PRO]: {
      maxServers: 10,
      maxRunningServers: 3,
      displayName: 'Pro',
    },
    [PlanType.PREMIUM]: {
      maxServers: -1, // -1 means unlimited
      maxRunningServers: 10,
      displayName: 'Premium',
    },
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Get user's current limits and usage
   */
  async getUserLimits(userId: string): Promise<UserLimits> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        servers: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const planConfig = this.PLAN_CONFIGS[user.planType];
    const currentServers = user.servers.length;
    const currentRunningServers = user.servers.filter(
      (s) => s.status === ServerStatus.RUNNING || s.status === ServerStatus.STARTING,
    ).length;

    const canCreateMore =
      planConfig.maxServers === -1 || currentServers < planConfig.maxServers;

    const canStartMore = currentRunningServers < planConfig.maxRunningServers;

    return {
      planType: user.planType,
      displayName: planConfig.displayName,
      maxServers: planConfig.maxServers,
      maxRunningServers: planConfig.maxRunningServers,
      currentServers,
      currentRunningServers,
      canCreateMore,
      canStartMore,
    };
  }

  /**
   * Check if user can create a new server
   * @throws ForbiddenException if limit is reached
   */
  async canCreateServer(userId: string): Promise<boolean> {
    const limits = await this.getUserLimits(userId);
    return limits.canCreateMore;
  }

  /**
   * Check if user can start another server
   * @throws ForbiddenException if limit is reached
   */
  async canStartServer(userId: string): Promise<boolean> {
    const limits = await this.getUserLimits(userId);
    return limits.canStartMore;
  }

  /**
   * Enforce server creation limit
   * @throws ForbiddenException if user cannot create more servers
   */
  async enforceCreateServerLimit(userId: string): Promise<void> {
    const limits = await this.getUserLimits(userId);

    if (!limits.canCreateMore) {
      const maxServersText =
        limits.maxServers === -1 ? 'unlimited' : limits.maxServers;

      throw new ForbiddenException(
        `Server creation limit reached. Your ${limits.displayName} plan allows ${maxServersText} servers (currently: ${limits.currentServers}). Please delete a server or upgrade your plan.`,
      );
    }

    this.logger.debug(
      `User ${userId} can create server (${limits.currentServers}/${limits.maxServers})`,
    );
  }

  /**
   * Enforce server start limit
   * @throws ForbiddenException if user cannot start more servers
   */
  async enforceStartServerLimit(userId: string): Promise<void> {
    const limits = await this.getUserLimits(userId);

    if (!limits.canStartMore) {
      throw new ForbiddenException(
        `Running server limit reached. Your ${limits.displayName} plan allows ${limits.maxRunningServers} running servers simultaneously (currently: ${limits.currentRunningServers}). Please stop another server first.`,
      );
    }

    this.logger.debug(
      `User ${userId} can start server (${limits.currentRunningServers}/${limits.maxRunningServers})`,
    );
  }

  /**
   * Get plan configuration for a specific plan type
   */
  getPlanConfig(planType: PlanType): PlanLimits {
    return this.PLAN_CONFIGS[planType];
  }

  /**
   * Get all plan configurations (useful for pricing page)
   */
  getAllPlanConfigs(): Record<PlanType, PlanLimits> {
    return this.PLAN_CONFIGS;
  }

  /**
   * Check if user has a specific plan
   */
  async hasMinimumPlan(userId: string, minimumPlan: PlanType): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { planType: true },
    });

    if (!user) {
      return false;
    }

    // Plan hierarchy: FREE < PRO < PREMIUM
    const planHierarchy = {
      [PlanType.FREE]: 0,
      [PlanType.PRO]: 1,
      [PlanType.PREMIUM]: 2,
    };

    return planHierarchy[user.planType] >= planHierarchy[minimumPlan];
  }
}
