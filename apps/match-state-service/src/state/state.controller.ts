import { Controller, Get } from "@nestjs/common";
import { StateService } from "./state.service";

@Controller()
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Get("state")
  getState() {
    return {
      ok: true,
      state: this.stateService.getLatest(),
    };
  }

  @Get("state/history")
  getHistory() {
    return {
      ok: true,
      history: this.stateService.getHistory(),
    };
  }

  @Get("health")
  getHealth() {
    return this.stateService.getHealth();
  }
}
