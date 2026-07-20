import { Module } from '@nestjs/common';
import { StationWorkflowService } from './station-workflow.service';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';

@Module({
  controllers: [StationsController],
  providers: [StationsService, StationWorkflowService],
  exports: [StationsService],
})
export class StationsModule {}
