// Model-free full-duration integration test of the SAME disk/chunk orchestrator
// used by JNI. The predictor is a gain fixture, NOT evidence of model quality.
#include "streaming.hpp"
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

static void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
static int source(int frame, int channel) {
    if (frame >= 60 * choir::SAMPLE_RATE && frame < 120 * choir::SAMPLE_RATE) return 0;
    return ((frame % 200 < 100) ? 1 : -1) * (channel ? 2000 : 4000);
}
static void makeInput(const std::string& path, int frames) {
    std::ofstream out(path, std::ios::binary);
    for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) {
        auto value = static_cast<uint16_t>(static_cast<int16_t>(source(i, c)));
        out.put(static_cast<char>(value & 255)); out.put(static_cast<char>(value >> 8));
    }
}
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    auto directory = std::filesystem::path(argv[1]);
    std::filesystem::create_directories(directory);
    auto pcm = (directory / "stream.pcm").string(), wav = (directory / "stream.wav").string();
    try {
        for (int seconds : {180, 900}) {
            int frames = seconds * choir::SAMPLE_RATE + (seconds == 180 ? 3 : 0);
            makeInput(pcm, frames);
            int calls = 0; float last = 0;
            choir::streamVocals(pcm, wav, [&](std::vector<float>& block, const choir::Progress& report) {
                require(block.size() <= static_cast<size_t>(choir::CORE_FRAMES + 2 * choir::CONTEXT_FRAMES) * 2, "Unbounded inference block");
                calls++;
                for (auto& sample : block) sample *= 0.5f;
                report(0.5f); report(1);
            }, [&](float f) { require(f >= last && f <= 1, "Progress regressed"); last = f; }, [] {});
            require(calls > 1 && last == 1, "Did not process multiple blocks");
            require(std::filesystem::file_size(wav) == static_cast<uintmax_t>(frames) * 4 + 44, "Song truncated or duplicated");
            require(std::filesystem::file_size(wav + ".analysis.f32") == static_cast<uintmax_t>((frames + 3) / 4) * 4, "Wrong analysis duration");
            std::ifstream in(wav, std::ios::binary); in.seekg(44);
            // Verify every sample, including ALL joins and the final frame.
            for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) {
                unsigned a = static_cast<unsigned char>(in.get()), b = static_cast<unsigned char>(in.get());
                int sample = a | (b << 8); if (sample >= 32768) sample -= 65536;
                int expected = static_cast<int>(std::lrint(source(i, c) / 32768.0f * 0.5f * 32767));
                require(sample == expected, "Lost context, reordered sample, silence gap or boundary error");
            }
            std::cout << "PASS model-free full-song stream: " << seconds << " seconds, " << calls << " inference blocks, exact samples/timestamps\n";
        }
        bool cancelled = false;
        try { choir::streamVocals(pcm, wav, [](std::vector<float>&, const choir::Progress&) {},
            [](float) {}, [] { throw std::runtime_error("cancel"); }); }
        catch (const std::runtime_error& e) { cancelled = std::string(e.what()) == "cancel"; }
        require(cancelled, "Cancellation ignored");
        bool stop = false, midCancelled = false;
        try { choir::streamVocals(pcm, wav, [](std::vector<float>&, const choir::Progress& report) { report(0.5f); },
            [&](float) { stop = true; }, [&] { if (stop) throw std::runtime_error("cancel-mid"); }); }
        catch (const std::runtime_error& e) { midCancelled = std::string(e.what()) == "cancel-mid"; }
        require(midCancelled, "Mid-job cancellation ignored");
        // Reject just over the 15-minute ceiling before allocating/inferring.
        std::filesystem::resize_file(pcm, static_cast<uintmax_t>(choir::MAX_FRAMES + 1) * 4);
        bool rejected = false;
        try { choir::streamVocals(pcm, wav, [](std::vector<float>&, const choir::Progress&) { throw std::runtime_error("Should not infer"); },
            [](float) {}, [] {}); }
        catch (const std::runtime_error& e) { rejected = std::string(e.what()).find("15 minutes") != std::string::npos; }
        require(rejected, "Oversized song accepted");
        std::filesystem::remove(pcm); std::filesystem::remove(wav); std::filesystem::remove(wav + ".analysis.f32");
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
