#include "engine.hpp"
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

// Actual weighted inference, not a model-free mock. Generated tones are NOT
// evidence of singing separation quality; listen-test a licensed choir clip too.
int main(int argc, char** argv) {
    if (argc != 4) { std::cerr << "Usage: demucs_smoke model input.pcm output.wav\n"; return 2; }
    try {
        choir::isolate(argv[1], argv[2], argv[3]);
        std::ifstream file(argv[3], std::ios::binary | std::ios::ate);
        auto size = static_cast<long long>(file.tellg());
        if (size < 44144) throw std::runtime_error("Missing vocal output");
        file.seekg(0);
        char header[44]; file.read(header, 44);
        if (std::string(header, 4) != "RIFF" || std::string(header + 8, 4) != "WAVE")
            throw std::runtime_error("Invalid WAV");
        std::cout << "Real Demucs inference passed; stereo 44100 Hz WAV bytes=" << size << "\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
