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
                const w = image.width;
                const h = image.height;
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(image, 0, 0, w, h);

                fileFieldWrapper.style.display = 'none';
                canvasFieldWrapper.style.display = 'block';

                resolve();
            };
        });
    });
})();