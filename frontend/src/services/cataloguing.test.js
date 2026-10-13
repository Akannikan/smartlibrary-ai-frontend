import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadataFromText } from './cataloguing.js';

test('extracts labeled metadata from multiline OCR without consuming following fields', () => {
  const metadata = extractMetadataFromText(`Title: The Quiet Library
Subtitle: A history of knowledge
Author: Jane A. Doe
Publisher: Example Press
Place of publication: London
Publication year: 2021
Edition: Second edition
ISBN-13: 978-0-306-40615-7
Pages: 245
Language: English
Physical description: xii, 245 pages : illustrations
Subjects: Libraries; History
DDC: 027.4
Call number: 027.4 DOE
Notes: Includes bibliographical references`);

  assert.equal(metadata.title, 'The Quiet Library');
  assert.equal(metadata.subtitle, 'A history of knowledge');
  assert.equal(metadata.author, 'Jane A. Doe');
  assert.equal(metadata.publisher, 'Example Press');
  assert.equal(metadata.publication_place, 'London');
  assert.equal(metadata.publication_year, '2021');
  assert.equal(metadata.edition, 'Second edition');
  assert.equal(metadata.isbn, '9780306406157');
  assert.equal(metadata.pages, '245');
  assert.equal(metadata.language, 'English');
  assert.equal(metadata.physical_description, 'xii, 245 pages : illustrations');
  assert.deepEqual(metadata.subjects, ['Libraries', 'History']);
  assert.equal(metadata.ddc_number, '027.4');
  assert.equal(metadata.call_number, '027.4 DOE');
  assert.equal(metadata.notes, 'Includes bibliographical references');
});

test('extracts fields when OCR places labels on the same line', () => {
  const metadata = extractMetadataFromText(
    'Title: Field Notes Author: Sam Reader Publisher: North Press Published in: Accra Published: 2019',
  );

  assert.equal(metadata.title, 'Field Notes');
  assert.equal(metadata.author, 'Sam Reader');
  assert.equal(metadata.publisher, 'North Press');
  assert.equal(metadata.publication_place, 'Accra');
  assert.equal(metadata.publication_year, '2019');
});

test('handles a simple title page and unlabelled ISBN, year, and page count', () => {
  const metadata = extractMetadataFromText(`THE GREAT LIBRARY
A history of knowledge
By Jane Ann Doe
© 2020
9780306406157
312 pages`);

  assert.equal(metadata.title, 'THE GREAT LIBRARY');
  assert.equal(metadata.subtitle, '');
  assert.equal(metadata.author, 'Jane Ann Doe');
  assert.equal(metadata.publication_year, '2020');
  assert.equal(metadata.isbn, '9780306406157');
  assert.equal(metadata.pages, '312');
});

test('returns empty strings for unsupported copy details instead of guessing them', () => {
  const metadata = extractMetadataFromText('Title: Book with no inventory details');

  assert.equal(metadata.title, 'Book with no inventory details');
  assert.equal(metadata.accession_number, undefined);
  assert.equal(metadata.source_of_acquisition, undefined);
  assert.equal(metadata.price, undefined);
});

test('does not append later OCR lines to the final labeled field', () => {
  const metadata = extractMetadataFromText('Title: A Short Book\nUnrelated footer text');

  assert.equal(metadata.title, 'A Short Book');
});

test('rejects an ISBN whose check digit is invalid', () => {
  const metadata = extractMetadataFromText('Title: A Book\nISBN: 978-1-23456-789-0');

  assert.equal(metadata.isbn, '');
});

test('does not use fragmented OCR characters as a title or author', () => {
  const metadata = extractMetadataFromText(`i 0 Te Ah ETT A
By oe de PS st gf 9 bi i I ES Ji`);

  assert.equal(metadata.title, '');
  assert.equal(metadata.author, '');
});

test('combines stacked cover title lines and picks out unlabelled author lines', () => {
  const metadata = extractMetadataFromText(`Conn Iggulden
The DANGEROUS
BOOK FOR BOYS
Hal Iggulden`);

  assert.equal(metadata.title, 'The DANGEROUS BOOK FOR BOYS');
  assert.equal(metadata.author, 'Conn Iggulden and Hal Iggulden');
});

test('keeps a plausible OCR author candidate when the title is unreadable', () => {
  const metadata = extractMetadataFromText(`Gonn lggulden
The`);

  assert.equal(metadata.title, '');
  assert.equal(metadata.author, 'Gonn lggulden');
});
