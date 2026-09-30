#include "gfx.h"

#include <math.h>
#include <string.h>

namespace gfx {

/* Standard RGB565 blend: spread the channels into a 32-bit word so all three
 * scale in one multiply. a is 0..255. */
static inline uint16_t blend(uint16_t dst, uint16_t src, uint32_t a) {
    uint32_t a5 = (a + 4) >> 3;
    if (a5 >= 32) return src;
    uint32_t d = (dst | ((uint32_t)dst << 16)) & 0x07E0F81F;
    uint32_t s = (src | ((uint32_t)src << 16)) & 0x07E0F81F;
    d = (d + (((s - d) * a5) >> 5)) & 0x07E0F81F;
    return (uint16_t)(d | (d >> 16));
}

static inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

/* max abs error ~0.0015 rad; plenty for splat outlines */
static inline float fastAtan2(float y, float x) {
    float ax = fabsf(x), ay = fabsf(y);
    float mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
    float a = mn / (mx + 1e-9f);
    float s = a * a;
    float r = ((-0.0464964749f * s + 0.15931422f) * s - 0.327622764f) * s * a + a;
    if (ay > ax) r = 1.57079637f - r;
    if (x < 0) r = 3.14159274f - r;
    if (y < 0) r = -r;
    return r;
}

/* ------------------------------------------------------------------ background
 * The radial gradient is baked by gen_assets.py as 4-bit palette indices and
 * copied to RAM once: reading it from flash every frame thrashes the cache. */
static uint8_t* s_bg = nullptr;
static uint16_t s_pal[16];

void initBackground() {
    memcpy(s_pal, BG_PAL, sizeof(s_pal));
    s_bg = (uint8_t*)malloc(sizeof(BG_NIB));
    if (s_bg) memcpy(s_bg, BG_NIB, sizeof(BG_NIB));
}

void background(Band& b) {
    const uint8_t* src = (s_bg ? s_bg : BG_NIB) + (b.y0 * b.W) / 2;
    uint16_t* p = b.px;
    for (int n = b.W * b.h / 2; n > 0; n--) {
        uint8_t v = *src++;
        *p++ = s_pal[v & 15];
        *p++ = s_pal[v >> 4];
    }
}

void fillRect(Band& b, float xf, float yf, float wf, float hf, uint16_t col, uint8_t alpha) {
    int x0 = (int)lroundf(xf), x1 = (int)lroundf(xf + wf);
    int y0 = (int)lroundf(yf), y1 = (int)lroundf(yf + hf);
    if (x0 < 0) x0 = 0;
    if (x1 > b.W) x1 = b.W;
    if (y0 < b.y0) y0 = b.y0;
    if (y1 > b.y0 + b.h) y1 = b.y0 + b.h;
    for (int y = y0; y < y1; y++) {
        uint16_t* p = b.px + (y - b.y0) * b.W;
        for (int x = x0; x < x1; x++) p[x] = blend(p[x], col, alpha);
    }
}

void line(Band& b, float x0, float y0, float x1, float y1, float width, uint16_t col, uint8_t alpha) {
    float hw = width * 0.5f;
    int bx0 = (int)floorf(fminf(x0, x1) - hw - 1), bx1 = (int)ceilf(fmaxf(x0, x1) + hw + 1);
    int by0 = (int)floorf(fminf(y0, y1) - hw - 1), by1 = (int)ceilf(fmaxf(y0, y1) + hw + 1);
    if (bx0 < 0) bx0 = 0;
    if (bx1 > b.W) bx1 = b.W;
    if (by0 < b.y0) by0 = b.y0;
    if (by1 > b.y0 + b.h) by1 = b.y0 + b.h;
    float dx = x1 - x0, dy = y1 - y0;
    float len2 = dx * dx + dy * dy;
    if (len2 < 1e-6f) return;
    for (int y = by0; y < by1; y++) {
        uint16_t* p = b.px + (y - b.y0) * b.W;
        for (int x = bx0; x < bx1; x++) {
            float px = x + 0.5f - x0, py = y + 0.5f - y0;
            float t = clamp01((px * dx + py * dy) / len2);
            float ex = px - t * dx, ey = py - t * dy;
            float cov = clamp01(hw - sqrtf(ex * ex + ey * ey) + 0.5f);
            if (cov > 0) p[x] = blend(p[x], col, (uint32_t)(alpha * cov));
        }
    }
}

/* ------------------------------------------------------------------ sprites */
void sprite(Band& b, const SpriteFrame& f, float cx, float cy, float dstW, float rot,
            bool mirror, uint8_t alpha, bool bottomHalf) {
    if (dstW <= 0 || alpha == 0) return;
    float dstH = dstW * f.h / f.w;
    float scale = f.w / dstW;                      /* source px per screen px */
    float lx0 = -dstW * 0.5f, lx1 = dstW * 0.5f;
    float ly0 = bottomHalf ? 0 : -dstH * 0.5f, ly1 = dstH * 0.5f;
    int vmin = bottomHalf ? f.h / 2 : 0;
    float v0 = bottomHalf ? f.h * 0.5f : 0;
    float cs = cosf(rot), sn = sinf(rot);
    float mx = mirror ? -1.0f : 1.0f;

    /* screen bbox of the rotated local rect */
    float minx = 1e9f, maxx = -1e9f, miny = 1e9f, maxy = -1e9f;
    const float lx[2] = {lx0, lx1}, ly[2] = {ly0, ly1};
    for (int i = 0; i < 2; i++)
        for (int j = 0; j < 2; j++) {
            float sx = (cs * lx[i] - sn * ly[j]) * mx;
            float sy = sn * lx[i] + cs * ly[j];
            minx = fminf(minx, sx); maxx = fmaxf(maxx, sx);
            miny = fminf(miny, sy); maxy = fmaxf(maxy, sy);
        }
    int bx0 = (int)floorf(cx + minx), bx1 = (int)ceilf(cx + maxx);
    int by0 = (int)floorf(cy + miny), by1 = (int)ceilf(cy + maxy);
    if (bx0 < 0) bx0 = 0;
    if (bx1 > b.W) bx1 = b.W;
    if (by0 < b.y0) by0 = b.y0;
    if (by1 > b.y0 + b.h) by1 = b.y0 + b.h;
    if (bx0 >= bx1 || by0 >= by1) return;

    const int fw = f.w, fh = f.h;
    for (int y = by0; y < by1; y++) {
        uint16_t* p = b.px + (y - b.y0) * b.W;
        float dy = y + 0.5f - cy;
        float dx = (bx0 + 0.5f - cx) * mx;
        /* inverse transform: s = R(-rot) * M * (p - c) */
        float sx = cs * dx + sn * dy;
        float sy = -sn * dx + cs * dy;
        float stepX = cs * mx, stepY = -sn * mx;
        for (int x = bx0; x < bx1; x++, sx += stepX, sy += stepY) {
            if (sx < lx0 || sx >= lx1 || sy < ly0 || sy >= ly1) continue;
            float u = (sx - lx0) * scale - 0.5f;
            float v = (sy - ly0) * scale + v0 - 0.5f;
            int iu = (int)floorf(u), iv = (int)floorf(v);
            float fu = u - iu, fv = v - iv;
            /* bilinear, premultiplied by alpha */
            float wa = 0, wr = 0, wg = 0, wb = 0;
            for (int k = 0; k < 4; k++) {
                int tu = iu + (k & 1), tv = iv + (k >> 1);
                if (tu < 0 || tu >= fw || tv < vmin || tv >= fh) continue;
                int idx = tv * fw + tu;
                uint8_t a = f.a[idx];
                if (!a) continue;
                float w = ((k & 1) ? fu : 1 - fu) * ((k >> 1) ? fv : 1 - fv) * a;
                uint16_t c = f.rgb[idx];
                wa += w;
                wr += w * (c >> 11);
                wg += w * ((c >> 5) & 0x3F);
                wb += w * (c & 0x1F);
            }
            if (wa < 1.0f) continue;
            float inv = 1.0f / wa;
            uint16_t col = ((uint16_t)(wr * inv + 0.5f) << 11) | ((uint16_t)(wg * inv + 0.5f) << 5) |
                           (uint16_t)(wb * inv + 0.5f);
            uint32_t a = (uint32_t)(wa * alpha) / 255;
            if (a) p[x] = blend(p[x], col, a > 255 ? 255 : a);
        }
    }
}

/* ------------------------------------------------------------------ splats */
void splat(Band& b, float x, float y, float base, float grow, uint8_t seed,
           uint16_t outer, uint16_t inner, uint8_t alpha) {
    const float TAU = 6.2831853f;
    float r = base * (1 + 0.2f * grow);
    float reach = fmaxf(r * 1.1f, base * 1.4f) + 1.5f;
    int bx0 = (int)floorf(x - reach), bx1 = (int)ceilf(x + reach);
    int by0 = (int)floorf(y - reach), by1 = (int)ceilf(y + reach);
    if (bx0 < 0) bx0 = 0;
    if (bx1 > b.W) bx1 = b.W;
    if (by0 < b.y0) by0 = b.y0;
    if (by1 > b.y0 + b.h) by1 = b.y0 + b.h;
    if (bx0 >= bx1 || by0 >= by1) return;

    /* spoke radii (polygon vertices k=0..16; vertex 16 closes back to 0) */
    float rr[17];
    for (int k = 0; k <= 16; k++) {
        float a = (k / 16.0f) * 6.283f;
        rr[k] = r * (0.65f + 0.45f * fabsf(sinf(a * 2.7f + seed * 2.1f)));
    }
    float dxs[4], dys[4], drs[4];
    for (int d = 0; d < 4; d++) {
        float a2 = (d / 4.0f) * 6.283f + seed * 0.9f;
        dxs[d] = x + cosf(a2) * base * 1.05f;
        dys[d] = y + sinf(a2) * base * 0.8f;
        drs[d] = base * (0.22f + 0.12f * fabsf(sinf(seed * 3 + d)));
    }
    float innerR = base * 0.45f;

    for (int py = by0; py < by1; py++) {
        uint16_t* p = b.px + (py - b.y0) * b.W;
        float dy = py + 0.5f - y;
        for (int px = bx0; px < bx1; px++) {
            float dx = px + 0.5f - x;
            /* jagged blob, tested in the 0.9-squashed space it was drawn in */
            float qy = dy / 0.9f;
            float d = sqrtf(dx * dx + qy * qy);
            float cov = 0;
            if (d < r * 1.1f + 1) {
                float ang = fastAtan2(qy, dx);
                if (ang < 0) ang += TAU;
                float fk = ang * (16.0f / TAU);
                int k = (int)fk;
                if (k > 15) k = 15;
                float edge = rr[k] + (rr[k + 1] - rr[k]) * (fk - k);
                cov = clamp01(edge - d + 0.5f);
            }
            for (int i = 0; i < 4 && cov < 1; i++) {
                float ex = px + 0.5f - dxs[i], ey = py + 0.5f - dys[i];
                float c2 = clamp01(drs[i] - sqrtf(ex * ex + ey * ey) + 0.5f);
                if (c2 > cov) cov = c2;
            }
            if (cov <= 0) continue;
            p[px] = blend(p[px], outer, (uint32_t)(alpha * cov));
            float ci = clamp01(innerR - sqrtf(dx * dx + dy * dy) + 0.5f);
            if (ci > 0) p[px] = blend(p[px], inner, (uint32_t)(alpha * ci));
        }
    }
}

/* ------------------------------------------------------------------ text */
static const Glyph* glyph(const Font& f, char ch) {
    uint8_t c = (uint8_t)ch;
    if (c < f.first || c > f.last) return nullptr;
    return &f.glyphs[c - f.first];
}

int textWidth(const Font& f, const char* s) {
    int w = 0;
    for (; *s; s++) {
        const Glyph* g = glyph(f, *s);
        if (g) w += g->adv;
    }
    return w;
}

int text(Band& b, const Font& f, int x, int baseline, const char* s, uint16_t col, uint8_t alpha) {
    int x0 = x;
    for (; *s; s++) {
        const Glyph* g = glyph(f, *s);
        if (!g) continue;
        int gx = x + g->xo, gy = baseline + g->yo;
        if (g->w && gy < b.y0 + b.h && gy + g->h > b.y0) {
            int r0 = b.y0 > gy ? b.y0 - gy : 0;
            int r1 = gy + g->h > b.y0 + b.h ? b.y0 + b.h - gy : g->h;
            for (int r = r0; r < r1; r++) {
                const uint8_t* src = f.alpha + g->off + r * g->w;
                uint16_t* p = b.px + (gy + r - b.y0) * b.W;
                for (int c = 0; c < g->w; c++) {
                    int sx = gx + c;
                    if (sx < 0 || sx >= b.W || !src[c]) continue;
                    p[sx] = blend(p[sx], col, (uint32_t)src[c] * alpha / 255);
                }
            }
        }
        x += g->adv;
    }
    return x - x0;
}

}  // namespace gfx
