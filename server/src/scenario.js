class Scene {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.sharescreens = [];
        this.voices = [];
    }
}

class ShareScreen {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.video;
        this.audio;
    }
}

class Voice {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.audio;
    }
}
