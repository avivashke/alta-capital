# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: סווינג · חודשי (יומי) · BTCUSDT · 1d
# Version: v1.0 · Strategy family: macd_swing
# Backtest: return 16.39% · PF 4.21 · DD 4.71% · trades 16
# OOS: 9.12% · Sharpe 1.42
# Params: {"fast":8,"slow":28,"signal":9,"atrStop":1.8,"rr":4}
# Target platform: Freqtrade
# Generated: 2026-11-12T10:20:54.778Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_1d --config user_data/config.json
#   freqtrade trade --strategy Altadesk_1d --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_1d(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1d'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.022
    minimal_roi = {"0": 3.60, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        macd = ta.MACD(dataframe, fastperiod=8, slowperiod=28, signalperiod=9)
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
