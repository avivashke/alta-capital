# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: בוט ייעודי · Doug & Silvia (BTCUSDT 1d) · BTCUSDT · 1d
# Version: v1.2 · Strategy family: structure_pullback
# Backtest: return 92.71% · PF 1.85 · DD 8.27% · trades 162
# OOS: 20.95% · Sharpe 1.13
# Params: {"fast":14,"slow":45,"pullbackBars":3,"rsiMid":52,"atrStop":2.1,"rr":2.9}
# Target platform: Freqtrade
# Generated: 2026-11-23T22:53:54.360Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altayt_bot_silvia_rumer_structure_pullback_BTCUS --config user_data/config.json
#   freqtrade trade --strategy Altayt_bot_silvia_rumer_structure_pullback_BTCUS --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altayt_bot_silvia_rumer_structure_pullback_BTCUS(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1d'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.025
    minimal_roi = {"0": 2.61, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        macd = ta.MACD(dataframe, fastperiod=14, slowperiod=45, signalperiod=9)
        dataframe['macd_hist'] = macd['macdhist']
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['macd_hist'] > 0)
        & (dataframe['close'] > dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['macd_hist'] < 0)
        & (dataframe['close'] < dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['macd_hist'] > 0)
        & (dataframe['close'] > dataframe['ema_trend'])
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['macd_hist'] < 0)
        & (dataframe['close'] < dataframe['ema_trend'])
            ),
            'exit_long',
        ] = 1
        return dataframe
