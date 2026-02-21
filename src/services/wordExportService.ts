
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, TextRun, VerticalAlign } from 'docx';
import { RubricData } from '../types';

export async function exportToWord(data: RubricData) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: data.title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.LEFT,
          spacing: { after: 300 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            // Row 1: Main Headers
            new TableRow({
              children: [
                createHeaderCell('Criteria', 20, 2), // Rowspan 2
                createHeaderCell('Ratings', 65, 1, 4), // Colspan 4
                createHeaderCell('Points', 15, 2), // Rowspan 2
              ],
            }),
            // Row 2: Rating Levels (Only sub-headers for Ratings)
            new TableRow({
              children: [
                createHeaderCell('Exemplary', 16.25),
                createHeaderCell('Proficient', 16.25),
                createHeaderCell('Developing', 16.25),
                createHeaderCell('Unsatisfactory', 16.25),
              ],
            }),
            // Data Rows
            ...data.criteria.map(item => new TableRow({
              children: [
                createCriteriaCell(item.category, item.description),
                createRatingCell(item.exemplary.text, item.exemplary.points),
                createRatingCell(item.proficient.text, item.proficient.points),
                createRatingCell(item.developing.text, item.developing.points),
                createRatingCell(item.unsatisfactory.text, item.unsatisfactory.points),
                createPointsCell(item.totalPoints),
              ],
            })),
            // Footer Row
            new TableRow({
              children: [
                new TableCell({
                  columnSpan: 5,
                  children: [new Paragraph({
                    children: [new TextRun({ text: 'Total Points', bold: true, size: 22, font: 'Arial' })],
                    alignment: AlignmentType.RIGHT,
                    spacing: { before: 100, after: 100 }
                  })],
                  verticalAlign: VerticalAlign.CENTER,
                }),
                new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({ text: `${data.totalPoints} points`, bold: true, size: 22, font: 'Arial' })],
                    alignment: AlignmentType.CENTER
                  })],
                  verticalAlign: VerticalAlign.CENTER,
                }),
              ],
            }),
          ],
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title.replace(/\s+/g, '_')}_Rubric.docx`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function createHeaderCell(text: string, width: number, rowSpan: number = 1, colSpan: number = 1) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    columnSpan: colSpan,
    rowSpan: rowSpan,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 22, font: 'Arial' })],
      alignment: AlignmentType.CENTER,
    })],
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: "f3f4f6" }
  });
}

function createCriteriaCell(title: string, desc: string) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 22, font: 'Arial' })],
      }),
      new Paragraph({
        children: [new TextRun({ text: desc, size: 22, font: 'Arial' })],
        spacing: { before: 100 },
      }),
    ],
    verticalAlign: VerticalAlign.TOP,
  });
}

function createRatingCell(text: string, points: string) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: points, bold: true, size: 22, font: 'Arial' })],
        spacing: { after: 100 },
        alignment: AlignmentType.CENTER
      }),
      new Paragraph({
        children: [new TextRun({ text, size: 22, font: 'Arial' })],
      }),
    ],
    verticalAlign: VerticalAlign.TOP,
  });
}

function createPointsCell(points: number) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: `${points} points`, size: 22, font: 'Arial' })],
        alignment: AlignmentType.CENTER
      }),
    ],
    verticalAlign: VerticalAlign.CENTER,
  });
}
