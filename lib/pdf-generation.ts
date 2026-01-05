
import jsPDF from "jspdf";
import { generateTimestamp } from "./utils";

export type PDFFont = "helvetica" | "times" | "courier";
export type PDFLayout = "1-up" | "4-up";

interface PDFOptions {
    title?: string;
    filename?: string;
    layout?: PDFLayout;
    font?: PDFFont;
}

/**
 * Calculate the total number of PDF pages based on frame count and layout
 * @param frameCount Number of frames/slides to include
 * @param layout PDF layout type
 * @returns Total number of PDF pages (including title page)
 */
export function calculatePDFPageCount(
    frameCount: number,
    layout: PDFLayout = "1-up"
): number {
    if (frameCount === 0) return 1; // Just title page

    if (layout === "4-up") {
        // 4 slides per page + 1 title page
        return Math.ceil(frameCount / 4) + 1;
    }

    // 1-up: 1 slide per page + 1 title page
    return frameCount + 1;
}

/**
 * Creates and downloads a PDF from a list of images (screenshots)
 */
export async function createAndDownloadPDF(
    screenshots: string[],
    options: PDFOptions = {}
): Promise<void> {
    try {
        const {
            title = "Video Analysis Slides",
            filename = `slides_${generateTimestamp()}.pdf`,
            layout = "1-up",
        } = options;

        if (screenshots.length === 0) {
            throw new Error("No screenshots selected");
        }

        // Create PDF - consistent A4 landscape for slides
        const pdf = new jsPDF({
            orientation: "landscape",
            unit: "mm",
            format: "a4",
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;

        // Add Title Page
        pdf.setFontSize(24);
        pdf.text(title, pageWidth / 2, pageHeight / 2 - 10, { align: "center" });
        pdf.setFontSize(12);
        pdf.text(`Generated on ${new Date().toLocaleDateString()}`, pageWidth / 2, pageHeight / 2 + 10, {
            align: "center",
        });
        pdf.text(`Total Slides: ${screenshots.length}`, pageWidth / 2, pageHeight / 2 + 20, {
            align: "center",
        });

        if (layout === "1-up") {
            // Single Slide per Page
            for (let i = 0; i < screenshots.length; i++) {
                pdf.addPage();
                const img = await loadImage(screenshots[i]);

                // Calculate dimensions to fit keeping aspect ratio
                const imgRatio = img.width / img.height;
                const availWidth = pageWidth - margin * 2;
                const availHeight = pageHeight - margin * 2;
                const pageRatio = availWidth / availHeight;

                let finalWidth, finalHeight;

                if (imgRatio > pageRatio) {
                    finalWidth = availWidth;
                    finalHeight = availWidth / imgRatio;
                } else {
                    finalHeight = availHeight;
                    finalWidth = availHeight * imgRatio;
                }

                const x = (pageWidth - finalWidth) / 2;
                const y = (pageHeight - finalHeight) / 2;

                pdf.addImage(img, "JPEG", x, y, finalWidth, finalHeight);

                // Add page number
                pdf.setFontSize(10);
                pdf.text(`${i + 1}`, pageWidth - 10, pageHeight - 5, { align: "right" });
            }
        } else if (layout === "4-up") {
            // 4 Slides per Page (2x2 Grid)
            // Grid config
            const cols = 2;
            const rows = 2;
            const slidesPerPage = cols * rows;
            const cellWidth = (pageWidth - margin * 2) / cols;
            const cellHeight = (pageHeight - margin * 2) / rows;
            // Inner padding for each cell
            const innerPadding = 5;

            for (let i = 0; i < screenshots.length; i++) {
                const positionOnPage = i % slidesPerPage;

                // New page if we filled the last one or it's the first screenshot (after title page)
                if (positionOnPage === 0) {
                    pdf.addPage();
                }

                const img = await loadImage(screenshots[i]);

                // Row and Col indices (0 or 1)
                const colIndex = positionOnPage % cols;
                const rowIndex = Math.floor(positionOnPage / cols);

                // Calculate cell center position
                const cellX = margin + colIndex * cellWidth;
                const cellY = margin + rowIndex * cellHeight;

                // Fit image within cell logic
                const availW = cellWidth - innerPadding * 2;
                const availH = cellHeight - innerPadding * 2;
                const imgRatio = img.width / img.height;
                const cellRatio = availW / availH;

                let finalW, finalH;

                if (imgRatio > cellRatio) {
                    finalW = availW;
                    finalH = availW / imgRatio;
                } else {
                    finalH = availH;
                    finalW = availH * imgRatio;
                }

                // Center in cell
                const x = cellX + innerPadding + (availW - finalW) / 2;
                const y = cellY + innerPadding + (availH - finalH) / 2;

                pdf.addImage(img, "JPEG", x, y, finalW, finalH);

                // Add slide number below image
                pdf.setFontSize(8);
                pdf.text(`${i + 1}`, cellX + cellWidth / 2, y + finalH + 4, { align: "center" });
            }
        }

        pdf.save(filename);
    } catch (error) {
        console.error("Error generating PDF:", error);
        throw error;
    }
}

// Helper to load image for PDF
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
