// Force-included into every TU of the wiring-test build so TFT_eSPI's
// SPI_FREQUENCY can be a runtime variable (see platformio.ini).
#pragma once
#ifndef __ASSEMBLER__
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
extern uint32_t tft_spi_hz;
#ifdef __cplusplus
}
#endif
#endif
