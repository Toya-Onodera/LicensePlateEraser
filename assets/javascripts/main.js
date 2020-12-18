(() => {
    const fileFieldWrapper = document.getElementById('file-field-wrapper');
    const canvasFieldWrapper = document.getElementById('canvas-field-wrapper');
    const inputImageElement = document.getElementById('input-image');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    inputImageElement.addEventListener('change', async (e) => {
        // e.target.files で選択されたファイルの概要が取得できる
        const file = e.target.files[0];

        // 画像を base64 に変換する
        // reader.readAsDataURL で変換できるが、非同期処理なので async/await を使用していい感じに書く
        const base64Image = await new Promise((resolve) => {
            const reader = new FileReader();

            reader.onload = () => {
                resolve(reader.result);
            };

            reader.readAsDataURL(file);
        });

        // 画像を Canvas 上に表示する
        await new Promise((resolve) => {
            const image = new Image();
            image.src = base64Image;

            image.onload = () => {
                let w = image.width;
                let h = image.height;
                let scale = 1;

                // 画像サイズを小さくする
                if (w >= (document.documentElement.clientWidth * 0.8)) {
                    scale = (document.documentElement.clientWidth * 0.8) / w;
                    w = w * scale;
                    h = h * scale;
                }

                if (h >= (document.documentElement.clientHeight * 0.8)) {
                    scale = (document.documentElement.clientHeight * 0.8) / h;
                    w = w * scale;
                    h = h * scale;
                }

                // 画面サイズに合わせて表示する
                // TODO: 解像度が落ちてしまうので対処法を考える
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(image, 0, 0, w, h);

                fileFieldWrapper.style.display = 'none';
                canvasFieldWrapper.style.display = 'flex';

                resolve();
            };
        });

        // 画像を GCP 上にアップロードし、ナンバープレートを検出する
        const GOOGLE_API_KEY = 'YOUR API KEY';
        const GOOGLE_CLOUD_VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_API_KEY}`;

        // GCP にアップロードするには base64 の先頭部分を取り除いた文字列が必要 -> /9j/... の文字列を作成する
        const sendBase64Image = (file.type === 'image/jpeg') ? base64Image.substr(23) : base64Image.substr(22);

        const requests = {
            "requests": [
                {
                    "image": {
                        "content": sendBase64Image
                    },
                    "features": [
                        {
                            "type": "OBJECT_LOCALIZATION"
                        }
                    ]
                }
            ]
        };

        const response = await fetch(GOOGLE_CLOUD_VISION_API_URL, {
            method: 'POST',
            redirected: true,
            body: JSON.stringify(requests),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        // localizedObjectAnnotations 内に推定結果が格納されている
        if ('localizedObjectAnnotations' in result['responses'][0]) {
            // ナンバーの推定結果が存在しているか調べる
            const localizedObjectAnnotations = result['responses'][0]['localizedObjectAnnotations'];
            const licensePlateIndex = localizedObjectAnnotations.findIndex((e) => e.name === 'License plate');

            // -1 が返ってきたらナンバーが推定されなかった
            if (licensePlateIndex !== -1) {
                // バウンディングボックス は左上から時計回りに返ってくる
                // 正則化された値が返ってくるので実際の座標データに変換する
                // とりあえず、左上が分かれば大丈夫なのでその部分だけ取り出す
                const plateStartX = Math.round(canvas.width * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][0]['x']);
                const plateStartY = Math.round(canvas.height * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][0]['y'])
                const plateWidth = Math.round(canvas.width * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][1]['x']) - Math.round(canvas.width * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][0]['x']);
                const plateHeight = Math.round(canvas.height * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][3]['y']) - Math.round(canvas.height * localizedObjectAnnotations[licensePlateIndex]['boundingPoly']['normalizedVertices'][0]['y']);

                // 色判定を行う
                // 指定範囲内の色情報を抜き出す
                const imageDataArray = ctx.getImageData(plateStartX, plateStartY, Math.round(plateWidth / 2), Math.round(plateHeight / 2)).data;
                const imageDataRgbaArray = imageDataArray.reduce((a, c, i) => i % 4 ? a : [...a, imageDataArray.slice(i, i + 4)], []);

                // 一般的に普通車のナンバーは白か黄色なのでそれを判別する
                // ナンバーの半分で色は判別できそうなので範囲を狭くする
                const colorClassifiedArray = imageDataRgbaArray.reduce((a, rgba) => {
                    const whiteRgb = [255, 255, 255];
                    const yellowRgb = [255, 255, 0];

                    const whiteEuclideanDistance = Math.hypot((rgba[0] - whiteRgb[0]), (rgba[1] - whiteRgb[1]), (rgba[2] - whiteRgb[2]));
                    const yellowEuclideanDistance = Math.hypot((rgba[0] - yellowRgb[0]), (rgba[1] - yellowRgb[1]), (rgba[2] - yellowRgb[2]));

                    // 白に似ている場合
                    // しきい値は適当に設定しているので確認が必要かも
                    if (whiteEuclideanDistance < yellowEuclideanDistance && whiteEuclideanDistance <= 70) {
                        a.white.push(rgba);
                    }

                    // 黄色に似ている場合
                    else if (yellowEuclideanDistance <= 70) {
                        a.yellow.push(rgba);
                    }

                    return a;
                }, {
                    white: [],
                    yellow: []
                });

                // 色の平均を取る関数
                const licensePlateRgb = (array) => {
                    const r = Math.round(array.reduce((a, c) => a + c[0], 0) / array.length);
                    const g = Math.round(array.reduce((a, c) => a + c[1], 0) / array.length);
                    const b = Math.round(array.reduce((a, c) => a + c[2], 0) / array.length);

                    return [r, g, b];
                };

                // 色の平均を取って自然なナンバー色にする
                const color = (colorClassifiedArray.white.length > colorClassifiedArray.yellow.length)
                    ? licensePlateRgb(colorClassifiedArray.white)
                    : licensePlateRgb(colorClassifiedArray.yellow);

                ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                ctx.fillRect(plateStartX, plateStartY, plateWidth, plateHeight);

                // 自動ダウンロードされるようにする
                const link = document.createElement("a");

                if (link.download !== undefined) {
                    const downloadBase64Image = canvas.toDataURL('image/png');
                    const fileName = `${new Date().toDateString().replace(/\\s+/g, "")}_${Math.round(Math.random() * 1000000000)}.png`;
                    link.setAttribute("href", downloadBase64Image);
                    link.setAttribute("download", fileName);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            }

            // ナンバーが検出できなかったので通知する
            else {
                alert('ナンバーが検出出来ませんでした…');
            }
        }
    });
})();