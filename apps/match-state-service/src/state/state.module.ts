import { Module } from "@nestjs/common";
import { StateService } from "./state.service";
import { StateController } from "./state.controller";
import { StateGateway } from "./state.gateway";

@Module({
  controllers: [StateController],
  providers: [StateService, StateGateway],
})
export class StateModule {}
