import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PlanLimitsService } from './services/plan-limits.service';
import { ResponseHelper } from '../../common/helpers/response.helper';

@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(
    private readonly planLimitsService: PlanLimitsService,
  ) {}

  /**
   * Get user's plan limits and current usage
   * GET /servers/limits
   */
  @Get('limits')
  async getLimits(@CurrentUser('id') userId: string) {
    try {
      const limits = await this.planLimitsService.getUserLimits(userId);
      return ResponseHelper.success(limits);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get all available plans and their limits
   * GET /servers/plans
   */
  @Get('plans')
  async getPlans() {
    try {
      const plans = this.planLimitsService.getAllPlanConfigs();
      return ResponseHelper.success(plans);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }
}
