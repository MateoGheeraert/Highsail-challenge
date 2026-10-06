import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { FORM_SCHEMA } from './form-schema.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
@UseGuards(SessionGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('schema')
  schema() { return FORM_SCHEMA; }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.jobs.list(request.authSession.user.id);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.jobs.get(request.authSession.user.id, id);
  }
}
