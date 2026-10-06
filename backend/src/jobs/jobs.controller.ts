import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { FORM_SCHEMA } from './form-schema.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
@UseGuards(SessionGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('schema')
  schema() { return FORM_SCHEMA; }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.jobs.create(request.authSession.user.id, body);
  }

  @Patch(':id')
  update(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.jobs.update(request.authSession.user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.jobs.delete(request.authSession.user.id, id);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.jobs.list(request.authSession.user.id);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.jobs.get(request.authSession.user.id, id);
  }
}
