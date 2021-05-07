const express = require('express');
const cors = require('cors');
const fs = require('fs');

const port = process.env.PORT || 5000;
const app = express();

app.use(cors({ origin: true }));

const plaintextEncodings = ['8bit', 'quoted-printable', '7bit'];
const encodings = [...plaintextEncodings, 'base64'];

function extractParts(lines) {
	const parts = [];

	if (lines.some((ln) => /\s*boundary=".+"$/.test(ln))) {
		let currentPart = {},
			inPart = false,
			boundary;
		for (const line of lines) {
			if (/\s*boundary=".+"$/.test(line)) {
				boundary = line.match(/\s*boundary="(?<boundary>.+)"$/).groups.boundary;
			}
			if (inPart && (line === 'Content-Type: multipart/alternative' || line === 'Content-Type: multipart/alternative;')) {
				inPart = false;
			}

			if (line === `--${boundary}`) {
				if (currentPart.lines) {
					currentPart.lines = currentPart.lines.filter((line) => line.trim() !== '');
					parts.push(currentPart);
					currentPart = {};
				}
				inPart = true;
				currentPart.name = boundary;
				currentPart.lines = [];
			} else if (inPart && line === `--${boundary}--`) {
				currentPart.lines = currentPart.lines.filter((line) => line.trim() !== '');
				parts.push(currentPart);
				currentPart = {};
				inPart = false;
			} else if (inPart) {
				currentPart.lines.push(line);
			}
		}
	} else {
		const part = { name: null, lines: [] };
		const headerLn = /^[A-Z][\w\-]+:/;
		const extraLn = /^[\t\s]+\w+/;

		let inContent = false;
		for (const line of lines) {
			if (headerLn.test(line) || extraLn.test(line)) {
				inContent = true;
			} else if (inContent) {
				part.lines.push(line);
			}
		}

		parts.lines = part.lines.filter((line) => line.trim() !== '');
		parts.push(part);
	}

	if (parts.length === 0) {
		throw new Error(boundary);
	}

	return parts;
}

app.post('/wakeup', (_, res) => {
	res.end();
});

app.get('/', (req, res) => {
	const files = fs.readdirSync('./spam');
	const amt = req.query.amt ? parseInt(req.query.amt) : files.length;
	const mail = files.slice(0, amt).map((path) => {
		const raw = fs.readFileSync(`./spam/${path}`).toString();
		const lines = raw.split(/\r?\n/);

		try {
			const parts = extractParts(lines);

			const textParts = [];
			for (const part of parts) {
				const encodingLine = part.lines.find((line) => line.startsWith('Content-Transfer-Encoding: '));
				const encoding = encodingLine?.split(': ')[1] || '8bit';
				if (!encodings.includes(encoding)) {
					console.log(path, 'Unrecognized Encoding', encoding);
				}

				const contentLines = part.lines.slice(part.lines.findIndex((ln) => !/[a-zA-Z\-]+: /.test(ln)));

				const plaintext = plaintextEncodings.includes(encoding)
					? contentLines.join('')
					: Buffer.from(contentLines.join(''), 'base64').toString('ascii');
				textParts.push(plaintext);
			}

			return textParts;
		} catch (e) {
			console.log(path, 'No Parts', e.message);
			return null;
		}
	});

	res.json(mail.reduce((arr, mail) => [...arr, ...mail], []));
});

app.listen(port, () => console.log(`Listening on port ${port}`));
