import type { QrIdentityPort } from "./qr-identity";

/**
 * The real QR implementation, over `qrcode` (generate) and `jsqr` (read).
 *
 * ## Why both imports are lazy
 *
 * Same reason as `SharpSheetImageProcessor`: this is reached through
 * `src/lib/wiring.ts`, which every page imports. A top-level import runs on every
 * render, turning a dependency only the answer sheet and the grader need into one the
 * whole app must load to boot. Deferred, a broken install costs one failed print or
 * grading run and a readable error, instead of a blank app.
 *
 * Neither package is native, so unlike `sharp` there is no platform-specific build to
 * get wrong on the NAS — but the import cost is real and the pattern is the house one.
 *
 * ## Error correction level
 *
 * Medium (~15% recoverable). Low would allow a smaller code at this payload size, but
 * the sheet is handled, folded and photographed; High would push the module count up
 * and shrink each module at the fixed printed size, which hurts more than the extra
 * redundancy helps.
 */
export class LibraryQrIdentity implements QrIdentityPort {
  private qrcodeModule?: typeof import("qrcode");
  private jsqrModule?: (typeof import("jsqr"))["default"];

  private async generator(): Promise<typeof import("qrcode")> {
    if (!this.qrcodeModule) {
      try {
        this.qrcodeModule = await import("qrcode");
      } catch (error) {
        throw new Error(
          "Cannot print a student QR code — the qrcode module failed to load. " +
            "Reinstall or redeploy. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.qrcodeModule;
  }

  private async reader(): Promise<(typeof import("jsqr"))["default"]> {
    if (!this.jsqrModule) {
      try {
        this.jsqrModule = (await import("jsqr")).default;
      } catch (error) {
        throw new Error(
          "Cannot read student QR codes — the jsqr module failed to load. " +
            "Reinstall or redeploy. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.jsqrModule;
  }

  async encodeSvg(payload: string): Promise<string> {
    const qrcode = await this.generator();

    const svg = await qrcode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "M",
      // No quiet zone from the library: the sheet draws its own white padding around
      // the block, and a doubled margin would shrink the modules for no gain.
      margin: 0,
    });

    // Strip the hardcoded `width`/`height`.
    //
    // `qrcode` emits `<svg width="256" height="256" viewBox="0 0 21 21">`. An SVG with
    // intrinsic dimensions ignores the width its container sets, so the printed code
    // came out at 256 CSS pixels — about a third of the page instead of a tenth — and
    // ran straight through the header and into the answer grid.
    //
    // The `viewBox` is what actually carries the geometry, so removing the two
    // attributes lets the element scale to whatever box the sheet gives it, with no
    // loss of fidelity. Anchored to the opening tag so a `width=` inside path data
    // cannot match.
    return svg.replace(/^<svg([^>]*)>/, (tag, attributes: string) =>
      `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/g, "")}>`,
    );
  }

  async decode(region: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): Promise<string | undefined> {
    const jsQR = await this.reader();

    // `attemptBoth` tries the image and its inverse. A scan of a sheet is normally
    // dark-on-light, but a photocopy or a "black and white" scanner setting can
    // invert it, and trying both costs one extra pass over a small crop.
    const found = jsQR(region.data, region.width, region.height, {
      inversionAttempts: "attemptBoth",
    });

    return found?.data ?? undefined;
  }
}
