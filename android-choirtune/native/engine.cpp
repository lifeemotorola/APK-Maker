#include "engine.hpp"
#include "model.hpp"
#include <algorithm>
#include <memory>
#include <stdexcept>

namespace choir {
std::atomic<bool> cancelled{false};
std::atomic<float> progress{0};
static void checkCancel() {
    if (cancelled.load()) throw std::runtime_error("Processing cancelled");
}
void isolate(const std::string& path, const std::string& pcm, const std::string& wav) {
    checkCancel();
    // Load once per song, lazily after the first non-silent block. Native
    // activations/stems are discarded between bounded, contextual blocks.
    std::unique_ptr<demucscpp::demucs_model> model;
    streamVocals(pcm, wav,
        [&](std::vector<float>& block, const Progress& report) {
            checkCancel();
            if (!model) {
                model = std::make_unique<demucscpp::demucs_model>();
                if (!demucscpp::load_demucs_model(path, model.get()) || !model->is_4sources)
                    throw std::runtime_error("Embedded four-stem Demucs model could not be loaded");
            }
            checkCancel();
            int frames = static_cast<int>(block.size() / 2);
            Eigen::MatrixXf audio(2, frames);
            for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) audio(c, i) = block[i * 2 + c];
            auto stems = demucscpp::demucs_inference(*model, audio,
                [&](float fraction, const std::string&) { checkCancel(); report(fraction); });
            if (stems.dimension(0) != 4 || stems.dimension(1) != 2 || stems.dimension(2) != frames)
                throw std::runtime_error("Unexpected Demucs output shape");
            // Stem 3 is blended VOCALS; stem 1 is not choir Bass.
            for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) block[i * 2 + c] = stems(3, c, i);
        }, [](float fraction) { progress = std::max(progress.load(), std::min(0.99f, fraction)); }, checkCancel);
    progress = 1.0f;
}
}
