import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public so Render can use /api as the service health check.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
