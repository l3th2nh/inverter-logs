// ============================================================================
//  portal.h - Captive portal cau hinh (AP + web form). Blocking cho toi khi luu.
// ============================================================================
#pragma once

// Mo AP + captive portal. Ham nay CHAY MAI (blocking); sau khi nguoi dung bam
// Luu -> luu NVS -> ESP.restart(). Goi khi chua cau hinh hoac giu nut BOOT.
void startPortal();
